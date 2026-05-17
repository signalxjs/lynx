package com.sigx.share

import android.content.Context
import android.content.Intent
import com.lynx.jsbridge.LynxMethod
import com.lynx.jsbridge.LynxModule
import com.lynx.react.bridge.ReadableMap

/**
 * Native share dialog module.
 * JS usage: NativeModules.Share.share({ title: "Check this out", message: "Hello!", url: "https://..." })
 */
class ShareModule(context: Context) : LynxModule(context) {

    @LynxMethod
    fun share(options: ReadableMap?) {
        if (options == null) return

        val title = if (options.hasKey("title")) options.getString("title") else null
        // `message` is the canonical key (matches the TS API); `text` is
        // accepted as a back-compat alias from older callers.
        val text = when {
            options.hasKey("message") -> options.getString("message")
            options.hasKey("text") -> options.getString("text")
            else -> null
        }
        val url = if (options.hasKey("url")) options.getString("url") else null

        val shareText = buildString {
            text?.let { append(it) }
            url?.let {
                if (isNotEmpty()) append("\n")
                append(it)
            }
        }

        val intent = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            if (title != null) putExtra(Intent.EXTRA_SUBJECT, title)
            if (shareText.isNotEmpty()) putExtra(Intent.EXTRA_TEXT, shareText)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }

        val chooser = Intent.createChooser(intent, title ?: "Share").apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        mContext.startActivity(chooser)
    }
}

