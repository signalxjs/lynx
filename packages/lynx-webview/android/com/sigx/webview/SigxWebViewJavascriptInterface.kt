package com.sigx.webview

import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface

/**
 * JS bridge exposed to the embedded page as `window.sigxBridge`. Calls into
 * [postMessage] arrive on the WebView's background JS thread; we hop to the
 * main thread before firing the `bindmessage` event so [SigxWebViewUI.fireEvent]
 * runs on the same thread Lynx expects.
 */
class SigxWebViewJavascriptInterface(private val owner: SigxWebViewUI) {

    private val mainHandler = Handler(Looper.getMainLooper())

    @JavascriptInterface
    fun postMessage(payload: String?) {
        val data = payload ?: ""
        mainHandler.post {
            owner.fireEvent("message", mapOf("data" to data))
        }
    }
}
