package com.sigx.webview

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import com.lynx.tasm.behavior.LynxContext
import com.lynx.tasm.behavior.LynxProp
import com.lynx.tasm.behavior.ui.LynxUI
import com.lynx.tasm.event.LynxDetailEvent

/**
 * Native UI for the `<sigx-webview>` JSX element on Android.
 *
 * Prop / event surface (v1):
 *   - `src`           → load a URL
 *   - `html`          → load inline HTML
 *   - `user-agent`    → custom UA string
 *   - `enable-debug`  → `WebView.setWebContentsDebuggingEnabled` (process-wide)
 *   - `bindload`      → page finished loading
 *   - `binderror`     → load failed
 *   - `bindmessage`   → page called `window.sigx.postMessage(payload)`
 *
 * Imperative methods (goBack / reload / postMessage from JS / injectJavaScript)
 * are tracked as a v2 follow-up.
 */
class SigxWebViewUI(context: LynxContext) : LynxUI<WebView>(context) {

    companion object {
        /** JS-side bridge name exposed to the page. Kept in sync with [bridgeUserScript]. */
        private const val BRIDGE_NAME = "sigxBridge"

        /**
         * Injected at `WebViewClient.onPageStarted` so it survives navigations.
         * Aliases `window.sigx.postMessage` to the `addJavascriptInterface`
         * bridge so authors get the same `window.sigx.postMessage('hi')` shape
         * as iOS.
         */
        private val bridgeUserScript = """
            (function() {
                if (window.sigx && window.sigx.postMessage) return;
                var bridge = window.${BRIDGE_NAME};
                if (!bridge) return;
                window.sigx = window.sigx || {};
                window.sigx.postMessage = function(payload) {
                    try { bridge.postMessage(typeof payload === 'string' ? payload : JSON.stringify(payload)); }
                    catch (e) { /* swallowed */ }
                };
            })();
        """.trimIndent()
    }

    @SuppressLint("SetJavaScriptEnabled", "AddJavascriptInterface")
    override fun createView(context: Context): WebView {
        val webView = WebView(context)
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            // Hardened defaults — the platform's pre-API-30 defaults for the
            // four flags below were `true`, which lets a malicious page loaded
            // via `file://` read arbitrary files and cross-origin URLs. Apps
            // that genuinely need local-file content can override these on a
            // forked component; we deliberately don't expose them as v1 props.
            allowFileAccess = false
            allowContentAccess = false
            @Suppress("DEPRECATION")
            allowFileAccessFromFileURLs = false
            @Suppress("DEPRECATION")
            allowUniversalAccessFromFileURLs = false
        }
        webView.webViewClient = object : WebViewClient() {
            override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                super.onPageStarted(view, url, favicon)
                // Inject the alias at start so the page can call
                // window.sigx.postMessage from inline / early scripts. The
                // underlying addJavascriptInterface bridge is always present.
                view?.evaluateJavascript(bridgeUserScript, null)
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                fireEvent("load", mapOf("url" to (url ?: "")))
            }

            override fun onReceivedError(
                view: WebView?,
                request: WebResourceRequest?,
                error: WebResourceError?,
            ) {
                super.onReceivedError(view, request, error)
                // Only surface main-frame failures to JS — subresource errors
                // (a missing favicon, a CDN image 404) shouldn't fire as a
                // top-level binderror.
                if (request?.isForMainFrame != true) return
                fireEvent(
                    "error",
                    mapOf(
                        "url" to (request.url?.toString() ?: ""),
                        "message" to (error?.description?.toString() ?: "unknown error"),
                    ),
                )
            }
        }
        webView.addJavascriptInterface(SigxWebViewJavascriptInterface(this), BRIDGE_NAME)
        return webView
    }

    // ── Prop setters ─────────────────────────────────────────────────────

    @LynxProp(name = "src")
    fun setSrc(value: String?) {
        if (value.isNullOrEmpty()) return
        if (!isSchemeAllowed(value)) {
            android.util.Log.w(
                "SigxWebView",
                "Rejected src with unsupported scheme: ${value.take(32)}…",
            )
            return
        }
        mView.loadUrl(value)
    }

    @LynxProp(name = "html")
    fun setHtml(value: String?) {
        if (value == null) return
        // baseURL=null intentionally — pages loaded via loadDataWithBaseURL
        // with a `file://` base could read local files in older Android
        // versions; a null base keeps the content fully sandboxed.
        mView.loadDataWithBaseURL(null, value, "text/html", "UTF-8", null)
    }

    @LynxProp(name = "user-agent")
    fun setUserAgent(value: String?) {
        // WebSettings.setUserAgentString(null) restores the platform default
        // — that's fine when the prop is reset, but we still null-guard for
        // clarity and to dodge the (rare) NPE Copilot flagged on older
        // WebView implementations.
        val ua = value ?: return
        mView.settings.userAgentString = ua
    }

    @LynxProp(name = "enable-debug")
    fun setEnableDebug(value: Boolean) {
        // Note: setWebContentsDebuggingEnabled is process-wide on Android, not
        // per-instance. Once enabled by any WebView, chrome://inspect picks it
        // up. Disabling is a no-op for already-attached debuggers.
        WebView.setWebContentsDebuggingEnabled(value)
    }

    // ── Event firing ─────────────────────────────────────────────────────

    internal fun fireEvent(name: String, params: Map<String, Any?>) {
        val event = LynxDetailEvent(sign, name)
        for ((k, v) in params) {
            event.addDetail(k, v)
        }
        lynxContext.eventEmitter.sendCustomEvent(event)
    }

    /**
     * Allow only `http(s)` and `about:` for the `src` prop. `javascript:` is
     * the headline XSS vector — a malicious server could redirect to it and
     * execute arbitrary JS in the WebView's renderer. `file:` is rejected
     * because we've disabled file access on the settings anyway, but the
     * scheme check is defense-in-depth in case a future maintainer flips
     * one back. Apps that genuinely need other schemes can use the `html`
     * prop (which is fully sandboxed) instead.
     */
    private fun isSchemeAllowed(url: String): Boolean {
        val trimmed = url.trim()
        if (trimmed.equals("about:blank", ignoreCase = true)) return true
        val colon = trimmed.indexOf(':')
        if (colon <= 0) return false
        val scheme = trimmed.substring(0, colon).lowercase()
        return scheme == "http" || scheme == "https"
    }
}
