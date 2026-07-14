package com.sigx.appstate

import android.content.Context
import com.lynx.jsbridge.LynxMethod
import com.lynx.jsbridge.LynxModule
import com.lynx.react.bridge.Callback
import com.lynx.react.bridge.JavaOnlyMap

/**
 * Sync-seed getter for the current app state.
 * JS usage:
 *   NativeModules.AppState.getAppState(callback)   // { state: 'active' | 'background' }
 *
 * Live transitions are delivered by [AppStatePublisher] via the
 * `appStateChanged` global event; this method exists so the JS side can
 * correct its `'active'` default on the rare background boot.
 */
class AppStateModule(context: Context) : LynxModule(context) {

    @LynxMethod
    fun getAppState(callback: Callback?) {
        val map = JavaOnlyMap().apply { putString("state", AppStateBus.current) }
        callback?.invoke(map)
    }
}
