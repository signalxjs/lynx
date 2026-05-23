package com.sigx.webview

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.os.Handler
import android.os.Looper
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import com.lynx.react.bridge.Callback
import com.lynx.react.bridge.JavaOnlyMap
import com.lynx.react.bridge.ReadableMap
import com.lynx.tasm.behavior.LynxContext
import com.lynx.tasm.behavior.LynxProp
import com.lynx.tasm.behavior.LynxUIMethod
import com.lynx.tasm.behavior.LynxUIMethodConstants
import com.lynx.tasm.behavior.ui.LynxUI
import com.lynx.tasm.event.LynxDetailEvent
import org.json.JSONArray

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
         * as iOS. Also exposes `window.sigxBridge.dispatchMessage` — the host
         * calls this from `evaluateJavascript` to deliver host → page
         * messages, which forwards to whatever the page registered as
         * `window.sigx.onmessage`.
         */
        private val bridgeUserScript = """
            (function() {
                var bridge = window.${BRIDGE_NAME};
                if (!bridge) return;
                window.sigx = window.sigx || {};
                if (!window.sigx.postMessage) {
                    window.sigx.postMessage = function(payload) {
                        try { bridge.postMessage(typeof payload === 'string' ? payload : JSON.stringify(payload)); }
                        catch (e) { /* swallowed */ }
                    };
                }
                // Host → page delivery slot. No-op until the page subscribes
                // by setting window.sigx.onmessage; handler exceptions are
                // swallowed so a bad page can't break the bridge.
                bridge.dispatchMessage = function(payload) {
                    try {
                        var fn = window.sigx && window.sigx.onmessage;
                        if (typeof fn === 'function') fn(payload);
                    } catch (e) { /* swallowed */ }
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

    // ── Imperative methods ───────────────────────────────────────────────
    //
    // Each `@LynxUIMethod` block is discovered by Lynx's annotation processor
    // (`com.lynx.tasm.behavior.LynxUIMethodsProcessor`) and routed via
    // `__InvokeUIMethod`. Status codes come from `LynxUIMethodConstants`:
    // `SUCCESS = 0`, `UNKNOWN = 1`. WebView methods MUST run on the UI
    // thread — Lynx's invoke dispatch is already main-thread on Android but
    // we hop explicitly to keep this readable.

    private val mainHandler = Handler(Looper.getMainLooper())

    @LynxUIMethod
    fun goBack(params: ReadableMap?, callback: Callback?) {
        mainHandler.post {
            if (mView.canGoBack()) mView.goBack()
            callback?.invoke(LynxUIMethodConstants.SUCCESS)
        }
    }

    @LynxUIMethod
    fun goForward(params: ReadableMap?, callback: Callback?) {
        mainHandler.post {
            if (mView.canGoForward()) mView.goForward()
            callback?.invoke(LynxUIMethodConstants.SUCCESS)
        }
    }

    @LynxUIMethod
    fun reload(params: ReadableMap?, callback: Callback?) {
        mainHandler.post {
            mView.reload()
            callback?.invoke(LynxUIMethodConstants.SUCCESS)
        }
    }

    @LynxUIMethod
    fun stopLoading(params: ReadableMap?, callback: Callback?) {
        mainHandler.post {
            mView.stopLoading()
            callback?.invoke(LynxUIMethodConstants.SUCCESS)
        }
    }

    @LynxUIMethod
    fun canGoBack(params: ReadableMap?, callback: Callback?) {
        mainHandler.post {
            val result = JavaOnlyMap().apply { putBoolean("value", mView.canGoBack()) }
            callback?.invoke(LynxUIMethodConstants.SUCCESS, result)
        }
    }

    @LynxUIMethod
    fun canGoForward(params: ReadableMap?, callback: Callback?) {
        mainHandler.post {
            val result = JavaOnlyMap().apply { putBoolean("value", mView.canGoForward()) }
            callback?.invoke(LynxUIMethodConstants.SUCCESS, result)
        }
    }

    /**
     * Evaluate JS in the page; return the last-expression value, stringified.
     * Non-string results (numbers, dicts, undefined) land as their
     * `toString()` so the wire shape matches iOS exactly.
     */
    @LynxUIMethod
    fun injectJavaScript(params: ReadableMap?, callback: Callback?) {
        val code = params?.getString("code").orEmpty()
        if (code.isEmpty()) {
            callback?.invoke(LynxUIMethodConstants.UNKNOWN, "injectJavaScript: missing `code` param")
            return
        }
        mainHandler.post {
            mView.evaluateJavascript(code) { result ->
                // Android wraps results in JSON-encoded quotes for strings;
                // strip them for parity with iOS's plain string form.
                val str = result?.let { stripJsonQuotes(it) } ?: ""
                val payload = JavaOnlyMap().apply { putString("result", str) }
                callback?.invoke(LynxUIMethodConstants.SUCCESS, payload)
            }
        }
    }

    /**
     * Host → page message. The bridge user-script's `dispatchMessage` helper
     * forwards to whatever handler the page registered as
     * `window.sigx.onmessage`. JSON-encoding via `JSONArray` puts the
     * payload through the same escape rules the engine uses, so embedded
     * quotes / newlines round-trip cleanly into the JS source.
     */
    @LynxUIMethod
    fun postMessage(params: ReadableMap?, callback: Callback?) {
        val data = params?.getString("data").orEmpty()
        val arrayLiteral = JSONArray().put(data).toString() // e.g. `["hi"]`
        val jsLiteral = arrayLiteral.substring(1, arrayLiteral.length - 1)
        val js = "window.sigxBridge && window.sigxBridge.dispatchMessage && window.sigxBridge.dispatchMessage($jsLiteral);"
        mainHandler.post {
            mView.evaluateJavascript(js) { _ ->
                callback?.invoke(LynxUIMethodConstants.SUCCESS)
            }
        }
    }

    private fun stripJsonQuotes(raw: String): String {
        if (raw.length >= 2 && raw.startsWith("\"") && raw.endsWith("\"")) {
            // The simplest safe path — parse as a 1-element JSON array so
            // escape sequences (`\\n`, `\\u00ff`, etc.) decode properly
            // instead of leaking into the wire.
            return try {
                JSONArray("[$raw]").getString(0)
            } catch (_: Throwable) {
                raw.substring(1, raw.length - 1)
            }
        }
        return raw
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
