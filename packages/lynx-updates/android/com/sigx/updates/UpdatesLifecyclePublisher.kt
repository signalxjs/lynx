package com.sigx.updates

import android.util.Log
import com.lynx.react.bridge.JavaOnlyArray
import com.lynx.react.bridge.JavaOnlyMap
import com.lynx.tasm.LynxView
import java.util.UUID

/**
 * Per-LynxView publisher: pumps [UpdatesEventBus] payloads into JS
 * (`__sigxUpdatesEvent`) and registers the view with [UpdateStore] so
 * `applyNow` has a reload target. Instantiated by the generated
 * `GeneratedLifecyclePublishers.attachAll(lynxView)`.
 */
class UpdatesLifecyclePublisher(private val lynxView: LynxView) {

    private var token: UUID? = null

    fun attach() {
        UpdateStore.attachView(lynxView)
        token = UpdatesEventBus.addListener { payload -> publish(payload) }
    }

    fun detach() {
        token?.let { UpdatesEventBus.removeListener(it) }
        token = null
    }

    private fun publish(payload: JavaOnlyMap) {
        try {
            val params = JavaOnlyArray()
            params.pushMap(payload)
            lynxView.sendGlobalEvent(UpdatesEventBus.CHANNEL, params)
        } catch (e: Throwable) {
            Log.w(TAG, "publish failed: ${e.message}")
        }
    }

    private companion object {
        const val TAG = "SigxUpdates"
    }
}
