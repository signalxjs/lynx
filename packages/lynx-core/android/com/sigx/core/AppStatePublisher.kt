package com.sigx.core

import android.util.Log
import com.lynx.react.bridge.JavaOnlyArray
import com.lynx.react.bridge.JavaOnlyMap
import com.lynx.tasm.LynxView
import java.util.UUID

/**
 * Per-LynxView publisher: forwards [AppStateBus] transitions to JS as
 * `appStateChanged` global events. Instantiated by the generated
 * `GeneratedLifecyclePublishers.attachAll(lynxView)`.
 */
class AppStatePublisher(private val lynxView: LynxView) {

    private var token: UUID? = null

    fun attach() {
        token = AppStateBus.addListener { state -> publish(state) }
    }

    fun detach() {
        token?.let { AppStateBus.removeListener(it) }
        token = null
    }

    private fun publish(state: String) {
        try {
            val payload = JavaOnlyMap().apply { putString("state", state) }
            val params = JavaOnlyArray().apply { pushMap(payload) }
            lynxView.sendGlobalEvent(EVENT_NAME, params)
        } catch (e: Throwable) {
            // Bridge calls during teardown can throw; the next transition
            // republishes, so a dropped publish is non-fatal.
            Log.w(TAG, "publish failed: ${e.message}")
        }
    }

    private companion object {
        const val TAG = "SigxAppState"
        const val EVENT_NAME = "appStateChanged"
    }
}
