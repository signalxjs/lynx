package com.sigx.devclient

import android.content.Context
import android.util.Log
import com.lynx.tasm.resourceprovider.LynxResourceCallback
import com.lynx.tasm.resourceprovider.LynxResourceRequest
import com.lynx.tasm.resourceprovider.LynxResourceResponse
import com.lynx.tasm.resourceprovider.template.LynxTemplateResourceFetcher
import com.lynx.tasm.resourceprovider.template.TemplateProviderResult
import okhttp3.Call
import okhttp3.Callback
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * Handles template and HMR hot-update fetching for LynxView.
 * Required for HMR to work — the AbsTemplateProvider only handles initial loads.
 */
@Suppress("UNCHECKED_CAST")
class DevTemplateResourceFetcher(context: Context) : LynxTemplateResourceFetcher() {

    private val appContext: Context = context.applicationContext

    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()

    override fun fetchTemplate(
        request: LynxResourceRequest,
        callback: LynxResourceCallback<TemplateProviderResult>
    ) {
        if (request == null) {
            callback.onResponse(failed("request is null"))
            return
        }

        val url = request.url
        if (url.startsWith("file://") || (!url.startsWith("http://") && !url.startsWith("https://"))) {
            fetchFromAssets(url.removePrefix("file://"), callback)
            return
        }

        val httpRequest = Request.Builder().url(url).build()
        httpClient.newCall(httpRequest).enqueue(object : Callback {
            override fun onResponse(call: Call, response: Response) {
                response.use {
                    if (it.isSuccessful && it.body != null) {
                        val bytes = it.body!!.bytes()
                        val result = TemplateProviderResult.fromBinary(bytes)
                        callback.onResponse(LynxResourceResponse.onSuccess(result))
                    } else {
                        callback.onResponse(failed("HTTP ${it.code}: ${it.message}"))
                    }
                }
            }

            override fun onFailure(call: Call, e: IOException) {
                Log.e("SigxDevClient", "Template resource fetch failed: ${request.url}", e)
                callback.onResponse(failed(e))
            }
        })
    }

    override fun fetchSSRData(
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

    private fun fetchFromAssets(
        path: String,
        callback: LynxResourceCallback<TemplateProviderResult>
    ) {
        try {
            val bytes = appContext.assets.open(path).use { it.readBytes() }
            val result = TemplateProviderResult.fromBinary(bytes)
            callback.onResponse(LynxResourceResponse.onSuccess(result))
        } catch (e: Exception) {
            callback.onResponse(failed(e))
        }
    }

    private fun <T> failed(message: String): LynxResourceResponse<T> =
        LynxResourceResponse.onFailed(Throwable(message)) as LynxResourceResponse<T>

    private fun <T> failed(e: Throwable): LynxResourceResponse<T> =
        LynxResourceResponse.onFailed(e) as LynxResourceResponse<T>
}
