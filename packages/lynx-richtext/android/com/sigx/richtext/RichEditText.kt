package com.sigx.richtext

import android.content.Context
import android.view.Gravity
import android.widget.EditText

/**
 * `EditText` subclass backing `<sigx-richtext>`.
 *
 * Adds a selection-change callback (EditText has no listener for it) and a
 * content-height helper for auto-grow reporting. Chip-aware deletion hooks
 * land in P3.
 */
class RichEditText(context: Context) : EditText(context) {

    var onSelectionChangedCallback: ((start: Int, end: Int) -> Unit)? = null

    init {
        background = null
        gravity = Gravity.TOP or Gravity.START
        setPadding(0, dp(8), 0, dp(8))
        // Text color stays at the platform default (textColorPrimary, which
        // tracks the system light/dark theme) unless the `text-color` prop
        // overrides it.
        isVerticalScrollBarEnabled = true
    }

    override fun onSelectionChanged(selStart: Int, selEnd: Int) {
        super.onSelectionChanged(selStart, selEnd)
        onSelectionChangedCallback?.invoke(selStart, selEnd)
    }

    /** Intrinsic content height (px) for the current width. */
    fun contentHeight(): Int {
        val l = layout ?: return paddingTop + paddingBottom + lineHeight
        return l.height + paddingTop + paddingBottom
    }

    private fun dp(value: Int): Int =
        (value * resources.displayMetrics.density).toInt()
}
