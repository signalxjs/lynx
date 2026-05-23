package com.sigx.audio

import android.util.Log
import com.lynx.react.bridge.JavaOnlyArray
import com.lynx.tasm.LynxView
import java.util.UUID

/**
 * Per-[LynxView] publisher that pumps [AudioEventBus] payloads into JS
 * via `LynxView.sendGlobalEvent(channel, [...])`. One instance per
 * LynxView; the autolinker generates `GeneratedLifecyclePublishers` which
 * instantiates and attaches us for each view.
 */
class AudioPublisher(private val lynxView: LynxView) {

    private var token: UUID? = null

    fun attach() {
        token = AudioEventBus.addListener { channel, payload ->
            try {
                val params = JavaOnlyArray()
                params.pushMap(payload)
                lynxView.sendGlobalEvent(channel, params)
            } catch (e: Throwable) {
                Log.w(TAG, "publish failed: ${e.message}")
            }
        }
    }

    fun detach() {
        token?.let { AudioEventBus.removeListener(it) }
        token = null
    }

    private companion object {
        const val TAG = "SigxAudioPublisher"
    }
}
