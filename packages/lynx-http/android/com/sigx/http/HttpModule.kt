package com.sigx.http

import android.content.Context
import com.lynx.jsbridge.LynxMethod
import com.lynx.jsbridge.LynxModule
import com.lynx.react.bridge.Callback
import com.lynx.react.bridge.JavaOnlyMap
import com.lynx.react.bridge.ReadableMap

/**
 * Native HTTP bridge — JS-callable side.
 *
 * JS usage (via the `@sigx/lynx-http` fetch shim, not directly):
 *
 *   NativeModules.Http.request(id, spec, cb)   // cb acks dispatch
 *   NativeModules.Http.abort(id, cb)
 *
 * `spec` is the `NativeRequestSpec` from `src/types.ts`. All outcomes are
 * pushed back via [HttpEventBus] (response → progress* → chunk* →
 * done | error), which a per-LynxView [HttpPublisher] forwards to JS
 * through `LynxView.sendGlobalEvent("__sigxHttpEvent", [...])`.
 */
class HttpModule(context: Context) : LynxModule(context) {

    @LynxMethod
    fun request(id: Int, spec: ReadableMap?, callback: Callback?) {
        if (spec == null) {
            callback?.invoke(JavaOnlyMap.from(mapOf("error" to "request spec is required")))
            return
        }
        val parsed = parseSpec(spec)
        if (parsed == null) {
            callback?.invoke(JavaOnlyMap.from(mapOf("error" to "invalid request spec")))
            return
        }
        HttpTaskStore.request(id, parsed, mContext)
        callback?.invoke(JavaOnlyMap.from(emptyMap<String, Any>()))
    }

    @LynxMethod
    fun abort(id: Int, callback: Callback?) {
        HttpTaskStore.abort(id)
        callback?.invoke(JavaOnlyMap.from(emptyMap<String, Any>()))
    }

    private fun parseSpec(spec: ReadableMap): HttpTaskStore.Spec? {
        val url = spec.getString("url") ?: return null

        val headers = mutableMapOf<String, String>()
        if (spec.hasKey("headers")) {
            val h = spec.getMap("headers")
            if (h != null) {
                val it = h.keySetIterator()
                while (it.hasNextKey()) {
                    val k = it.nextKey()
                    h.getString(k)?.let { v -> headers[k] = v }
                }
            }
        }

        val body = if (spec.hasKey("body")) spec.getMap("body") else null
        val bodyType = body?.getString("type") ?: "none"

        val parts = mutableListOf<HttpTaskStore.Part>()
        if (bodyType == "multipart" && body != null && body.hasKey("parts")) {
            val arr = body.getArray("parts")
            if (arr != null) {
                for (i in 0 until arr.size()) {
                    val p = arr.getMap(i) ?: continue
                    parts.add(
                        HttpTaskStore.Part(
                            kind = p.getString("kind") ?: "field",
                            name = p.getString("name") ?: "",
                            value = if (p.hasKey("value")) p.getString("value") else null,
                            uri = if (p.hasKey("uri")) p.getString("uri") else null,
                            filename = if (p.hasKey("filename")) p.getString("filename") else null,
                            contentType = if (p.hasKey("contentType")) p.getString("contentType") else null,
                        )
                    )
                }
            }
        }

        return HttpTaskStore.Spec(
            url = url,
            method = (spec.getString("method") ?: "GET").uppercase(),
            headers = headers,
            streaming = spec.hasKey("streaming") && spec.getBoolean("streaming"),
            bodyType = bodyType,
            bodyText = if (body != null && body.hasKey("text")) body.getString("text") else null,
            bodyBase64 = if (body != null && body.hasKey("data")) body.getString("data") else null,
            boundary = if (body != null && body.hasKey("boundary")) body.getString("boundary") else null,
            parts = parts,
        )
    }
}
