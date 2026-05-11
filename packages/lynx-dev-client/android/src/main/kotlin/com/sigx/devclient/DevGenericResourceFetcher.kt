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
        request: LynxResourceRequest,
        callback: LynxResourceCallback<ByteArray>
    ) {
        if (request == null) {
            callback.onResponse(failed("request is null"))
            return
        }

        val httpRequest = Request.Builder().url(request.url).build()
        httpClient.newCall(httpRequest).enqueue(object : Callback {
            override fun onResponse(call: Call, response: Response) {
                response.use {
                    if (it.isSuccessful && it.body != null) {
                        callback.onResponse(LynxResourceResponse.onSuccess(it.body!!.bytes()))
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
