package com.sigx.webview

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import com.lynx.react.bridge.JavaOnlyMap
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
        mView.loadUrl(value)
    }

    @LynxProp(name = "html")
    fun setHtml(value: String?) {
        if (value == null) return
        mView.loadDataWithBaseURL(null, value, "text/html", "UTF-8", null)
    }

    @LynxProp(name = "user-agent")
    fun setUserAgent(value: String?) {
        mView.settings.userAgentString = value
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
}
