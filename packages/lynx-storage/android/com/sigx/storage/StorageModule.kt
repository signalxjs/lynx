package com.sigx.storage

import android.content.Context
import android.content.SharedPreferences
import com.lynx.jsbridge.LynxMethod
import com.lynx.jsbridge.LynxModule
import com.lynx.react.bridge.Callback
import com.lynx.react.bridge.JavaOnlyArray
import com.lynx.react.bridge.JavaOnlyMap

/**
 * Persistent key-value storage module (SharedPreferences-backed).
 * JS usage: NativeModules.Storage.setItem("key", "value")
 *           NativeModules.Storage.getItem("key", callback)
 */
class StorageModule(context: Context) : LynxModule(context) {

    private val prefs: SharedPreferences by lazy {
        mContext.getSharedPreferences("sigx_lynxgo_storage", Context.MODE_PRIVATE)
    }

    @LynxMethod
    fun setItem(key: String?, value: String?) {
        if (key != null) {
            prefs.edit().putString(key, value).apply()
        }
    }

    @LynxMethod
    fun getItem(key: String?, callback: Callback?) {
        val value = if (key != null) prefs.getString(key, null) else null
        callback?.invoke(value)
    }

    @LynxMethod
    fun removeItem(key: String?) {
        if (key != null) {
            prefs.edit().remove(key).apply()
        }
    }

    @LynxMethod
    fun clear() {
        prefs.edit().clear().apply()
    }

    @LynxMethod
    fun getAllKeys(callback: Callback?) {
        val keys = JavaOnlyArray()
        prefs.all.keys.forEach { keys.pushString(it) }
        callback?.invoke(keys)
    }

    @LynxMethod
    fun multiGet(keys: String?, callback: Callback?) {
        // keys is a JSON-encoded string array for simplicity
        if (keys == null) { callback?.invoke(null); return }
        val result = JavaOnlyMap()
        try {
            val keyList = keys.split(",").map { it.trim() }
            keyList.forEach { key ->
                result.putString(key, prefs.getString(key, null))
            }
        } catch (_: Exception) {}
        callback?.invoke(result)
    }
}

