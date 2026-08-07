package com.sigx.clipboard

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import com.lynx.jsbridge.LynxMethod
import com.lynx.jsbridge.LynxModule
import com.lynx.react.bridge.Callback
import com.lynx.react.bridge.JavaOnlyMap

/**
 * Native clipboard access module.
 * JS usage: NativeModules.Clipboard.setString("hello")
 *           NativeModules.Clipboard.getString(callback)
 */
class ClipboardModule(context: Context) : LynxModule(context) {

    private val clipboard: ClipboardManager by lazy {
        mContext.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    }

    /**
     * Writes to the clipboard and reports the outcome.
     *
     * `setPrimaryClip` really can fail — a clip larger than the binder
     * transaction limit throws, and OEM clipboard managers have been known to
     * as well. That failure used to be invisible to JS because this method
     * returned nothing.
     */
    @LynxMethod
    fun setString(text: String?, callback: Callback?) {
        try {
            val clip = ClipData.newPlainText("sigx-lynx-go", text ?: "")
            clipboard.setPrimaryClip(clip)
            callback?.invoke(JavaOnlyMap())
        } catch (e: Throwable) {
            val map = JavaOnlyMap()
            map.putString("error", e.message ?: "setPrimaryClip failed")
            callback?.invoke(map)
        }
    }

    @LynxMethod
    fun getString(callback: Callback?) {
        val text = clipboard.primaryClip
            ?.getItemAt(0)
            ?.text
            ?.toString() ?: ""
        callback?.invoke(text)
    }

    @LynxMethod
    fun hasString(callback: Callback?) {
        val has = clipboard.hasPrimaryClip() &&
                clipboard.primaryClipDescription?.hasMimeType("text/*") == true
        callback?.invoke(has)
    }
}

