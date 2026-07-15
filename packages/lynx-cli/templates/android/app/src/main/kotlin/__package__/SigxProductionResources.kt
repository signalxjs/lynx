package {{packageName}}

import android.content.Context
import com.lynx.tasm.resourceprovider.LynxResourceCallback
import com.lynx.tasm.resourceprovider.LynxResourceRequest
import com.lynx.tasm.resourceprovider.LynxResourceResponse
import com.lynx.tasm.resourceprovider.generic.LynxGenericResourceFetcher
import com.lynx.tasm.resourceprovider.generic.StreamDelegate
import com.lynx.tasm.resourceprovider.template.LynxTemplateResourceFetcher
import com.lynx.tasm.resourceprovider.template.TemplateProviderResult
import okhttp3.Call
import okhttp3.Callback
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import java.io.File
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * Resolves embedded Lynx assets (async chunks from dynamic `import()`) in
 * production builds. `sigx run:android --release` / `sigx prebuild
 * --embed-bundle` mirror everything under `dist/static/js/async/` into
 * `src/main/assets/`; the fetchers below map the runtime's root-relative
 * request URLs (`/static/js/async/<hash>.js`) back onto those assets.
 *
 * Note: Kotlin block comments nest, so never write a `/`+`**` glob in one —
 * it opens a nested comment and swallows the rest of the file. (#599)
 */
object SigxEmbeddedAssets {
    /**
     * Extra search roots checked before the APK assets, highest priority
     * first — e.g. an OTA update's directory, so a downloaded bundle can ship
     * its own chunks in the future.
     */
    var extraRoots: List<File> = emptyList()

    /**
     * Map a chunk request URL to its dist-relative asset path. Accepts
     * root-relative paths (`/static/js/async/x.js`), absolute URLs with any
     * scheme/host (custom assetPrefix), and bare relative paths. The
     * `static/` marker fallback keeps CDN-prefixed URLs resolvable offline.
     */
    fun relativePath(url: String): String? {
        var path = url
        val schemeEnd = url.indexOf("://")
        if (schemeEnd > 0) {
            val afterScheme = url.substring(schemeEnd + 3)
            val slash = afterScheme.indexOf('/')
            path = if (slash >= 0) afterScheme.substring(slash) else ""
        }
        // Strip any query / fragment — a cache-busting `?v=…` would otherwise
        // become part of the filename we look for on disk. (Matches the iOS
        // fetcher.)
        val trimmed = path.trimStart('/').substringBefore('?').substringBefore('#')
        if (trimmed.isEmpty()) return null
        // Refuse traversal: this fetcher resolves against the APK assets and
        // the OTA directory, and an OTA bundle is downloaded content — without
        // this, a crafted `…/async/../../../secret` URL would read arbitrary
        // local files via File(root, rel).
        if (trimmed.split('/').any { it == ".." }) return null
        if (trimmed.startsWith("static/")) return trimmed
        val marker = trimmed.indexOf("static/js/async/")
        if (marker >= 0) return trimmed.substring(marker)
        return trimmed
    }

    /** Read the embedded asset for [url], or null when none exists. */
    fun open(context: Context, url: String): ByteArray? {
        val rel = relativePath(url) ?: return null
        for (root in extraRoots) {
            val file = File(root, rel)
            if (file.isFile) return runCatching { file.readBytes() }.getOrNull()
        }
        return runCatching { context.assets.open(rel).use { it.readBytes() } }.getOrNull()
    }
}

/**
 * Serves dynamic-import chunks (`lynx.requireModuleAsync`) from embedded
 * assets in production. Without a registered generic resource fetcher the
 * engine rejects every external JS request with "No available provider or
 * fetcher". Remote http(s) URLs (custom assetPrefix pointing at a CDN) fall
 * back to the network.
 */
@Suppress("UNCHECKED_CAST")
class ProductionGenericResourceFetcher(context: Context) : LynxGenericResourceFetcher() {

    private val appContext: Context = context.applicationContext

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
        // failure (and render the check dead code).
        if (request == null) {
            callback.onResponse(failed("request is null"))
            return
        }

        SigxEmbeddedAssets.open(appContext, request.url)?.let {
            callback.onResponse(LynxResourceResponse.onSuccess(it))
            return
        }

        if (request.url.startsWith("http://") || request.url.startsWith("https://")) {
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
            return
        }

        callback.onResponse(failed(
            "No embedded asset for ${request.url}. Rebuild with `sigx run:android --release` "
            + "(or `sigx prebuild --embed-bundle` after `sigx build`) so async chunks are embedded."
        ))
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

/**
 * Template counterpart of [ProductionGenericResourceFetcher] — some engine
 * paths fetch template-typed resources through this hook instead.
 */
@Suppress("UNCHECKED_CAST")
class ProductionTemplateResourceFetcher(context: Context) : LynxTemplateResourceFetcher() {

    private val appContext: Context = context.applicationContext

    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()

    override fun fetchTemplate(
        request: LynxResourceRequest?,
        callback: LynxResourceCallback<TemplateProviderResult>
    ) {
        if (request == null) {
            callback.onResponse(failed("request is null"))
            return
        }

        SigxEmbeddedAssets.open(appContext, request.url)?.let {
            callback.onResponse(LynxResourceResponse.onSuccess(TemplateProviderResult.fromBinary(it)))
            return
        }

        if (request.url.startsWith("http://") || request.url.startsWith("https://")) {
            val httpRequest = Request.Builder().url(request.url).build()
            httpClient.newCall(httpRequest).enqueue(object : Callback {
                override fun onResponse(call: Call, response: Response) {
                    response.use {
                        if (it.isSuccessful && it.body != null) {
                            callback.onResponse(LynxResourceResponse.onSuccess(
                                TemplateProviderResult.fromBinary(it.body!!.bytes())
                            ))
                        } else {
                            callback.onResponse(failed("HTTP ${it.code}: ${it.message}"))
                        }
                    }
                }

                override fun onFailure(call: Call, e: IOException) {
                    callback.onResponse(failed(e))
                }
            })
            return
        }

        callback.onResponse(failed("No embedded template for ${request.url}"))
    }

    override fun fetchSSRData(
        request: LynxResourceRequest?,
        callback: LynxResourceCallback<ByteArray>
    ) {
        callback.onResponse(failed("SSR not supported"))
    }

    private fun <T> failed(message: String): LynxResourceResponse<T> =
        LynxResourceResponse.onFailed(Throwable(message)) as LynxResourceResponse<T>

    private fun <T> failed(e: Throwable): LynxResourceResponse<T> =
        LynxResourceResponse.onFailed(e) as LynxResourceResponse<T>
}
