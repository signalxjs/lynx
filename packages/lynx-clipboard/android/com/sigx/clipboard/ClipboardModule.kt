package com.sigx.clipboard

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import com.lynx.jsbridge.LynxMethod
import com.lynx.jsbridge.LynxModule
import com.lynx.react.bridge.Callback

/**
 * Native clipboard access module.
 * JS usage: NativeModules.Clipboard.setString("hello")
 *           NativeModules.Clipboard.getString(callback)
 */
class ClipboardModule(context: Context) : LynxModule(context) {

    private val clipboard: ClipboardManager by lazy {
        mContext.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    }

    @LynxMethod
    fun setString(text: String?) {
        val clip = ClipData.newPlainText("sigx-lynx-go", text ?: "")
        clipboard.setPrimaryClip(clip)
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

