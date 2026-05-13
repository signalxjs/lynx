package com.sigx.websocket

import android.util.Base64
import android.util.Log
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import okio.ByteString.Companion.toByteString
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

/**
 * Process-wide registry of live OkHttp [WebSocket] instances keyed by the
 * JS-supplied numeric id. Sockets outlive any single LynxView (a page
 * reload should not drop in-flight sockets that the JS bundle is
 * re-attaching to).
 */
internal object WebSocketTaskStore {

    private const val TAG = "SigxWebSocketStore"

    private val sockets = ConcurrentHashMap<Int, WebSocket>()

    private val client: OkHttpClient by lazy {
        OkHttpClient.Builder()
            // No read timeout on established sockets — close frames drive teardown.
            .readTimeout(0, TimeUnit.MILLISECONDS)
            .pingInterval(0, TimeUnit.MILLISECONDS)
            .build()
    }

    fun create(id: Int, url: String, protocols: List<String>) {
        // If JS re-uses an id (shouldn't — ids are monotonic), tear down
        // the prior socket first to avoid leaks.
        sockets.remove(id)?.cancel()

        val builder = Request.Builder().url(url)
        if (protocols.isNotEmpty()) {
            builder.addHeader("Sec-WebSocket-Protocol", protocols.joinToString(", "))
        }
        val request = builder.build()
        val ws = client.newWebSocket(request, Listener(id))
        sockets[id] = ws
    }

    fun send(id: Int, payload: String, isBinary: Boolean): Boolean {
        val ws = sockets[id] ?: return false
        return if (isBinary) {
            // Payload is base64-encoded on the JS side — decode to raw bytes.
            val bytes = try {
                Base64.decode(payload, Base64.DEFAULT)
            } catch (e: IllegalArgumentException) {
                Log.w(TAG, "send($id) invalid base64: ${e.message}")
                return false
            }
            ws.send(bytes.toByteString())
        } else {
            ws.send(payload)
        }
    }

    fun close(id: Int, code: Int, reason: String) {
        val ws = sockets[id] ?: return
        // OkHttp returns false if the socket is already closing/closed —
        // either way the listener will fire and we'll clean up.
        ws.close(code, reason)
    }

    private fun forget(id: Int) {
        sockets.remove(id)
    }

    /**
     * OkHttp WebSocketListener — converts OkHttp callbacks into
     * [WebSocketEventBus] publishes. One listener per socket so we can
     * capture the id in the closure.
     */
    private class Listener(private val id: Int) : WebSocketListener() {

        override fun onOpen(webSocket: WebSocket, response: Response) {
            val protocol = response.header("Sec-WebSocket-Protocol") ?: ""
            val extensions = response.header("Sec-WebSocket-Extensions") ?: ""
            WebSocketEventBus.publishOpen(id, protocol, extensions)
        }

        override fun onMessage(webSocket: WebSocket, text: String) {
            WebSocketEventBus.publishMessageText(id, text)
        }

        override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
            val b64 = Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP)
            WebSocketEventBus.publishMessageBinary(id, b64)
        }

        override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
            // Echo the peer's close back — OkHttp does the responding close
            // for us automatically here.
            webSocket.close(code, reason)
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
            forget(id)
            WebSocketEventBus.publishClose(id, code, reason, wasClean = true)
        }

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
            forget(id)
            WebSocketEventBus.publishError(id, t.message ?: t.javaClass.simpleName)
            WebSocketEventBus.publishClose(id, 1006, t.message ?: "", wasClean = false)
        }
    }
}
