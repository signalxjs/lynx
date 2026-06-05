package com.sigx.richtext

import android.content.Context
import android.text.Spanned
import android.view.Gravity
import android.view.MotionEvent
import android.widget.EditText

/**
 * `EditText` subclass backing `<sigx-richtext>`.
 *
 * Adds a selection-change callback (EditText has no listener for it), a
 * content-height helper for auto-grow reporting, and checkbox hit-testing for
 * task lines (the checkbox is draw-only — see [SigxBlockSpan] — so taps on it
 * are intercepted here instead of moving the caret). Chip-aware deletion
 * hooks land in P3.
 */
class RichEditText(context: Context) : EditText(context) {

    var onSelectionChangedCallback: ((start: Int, end: Int) -> Unit)? = null

    /** Tap landed on a task line's checkbox gutter — paragraph span bounds. */
    var onCheckboxTap: ((parStart: Int, parEnd: Int) -> Unit)? = null

    private var pendingCheckboxSpan: SigxBlockSpan? = null

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

    /**
     * Intercept taps that land inside a task line's checkbox gutter — and
     * ONLY those: anything else falls through to normal editing untouched.
     * Down and up must hit the same line's gutter to count as a toggle tap.
     */
    override fun onTouchEvent(event: MotionEvent): Boolean {
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                pendingCheckboxSpan = hitTaskCheckbox(event)
                if (pendingCheckboxSpan != null) return true
            }
            MotionEvent.ACTION_UP -> {
                val span = pendingCheckboxSpan
                pendingCheckboxSpan = null
                if (span != null) {
                    if (hitTaskCheckbox(event) === span) {
                        val spanned = text as Spanned
                        onCheckboxTap?.invoke(spanned.getSpanStart(span), spanned.getSpanEnd(span))
                    }
                    return true
                }
            }
            MotionEvent.ACTION_CANCEL -> pendingCheckboxSpan = null
        }
        return super.onTouchEvent(event)
    }

    /** The task block span whose checkbox gutter contains the touch, if any. */
    private fun hitTaskCheckbox(event: MotionEvent): SigxBlockSpan? {
        val l = layout ?: return null
        val spanned = text as? Spanned ?: return null
        val y = (event.y + scrollY - totalPaddingTop).toInt()
        if (y < 0 || y >= l.height) return null
        val line = l.getLineForVertical(y)
        val lineStart = l.getLineStart(line)
        // The marker draws only on the paragraph's first visual line.
        val span = spanned.getSpans(lineStart, minOf(lineStart + 1, spanned.length), SigxBlockSpan::class.java)
            .firstOrNull { it.type == "task" && spanned.getSpanStart(it) == lineStart }
            ?: return null
        val x = event.x + scrollX - totalPaddingLeft
        return if (x >= 0f && x <= span.getLeadingMargin(true)) span else null
    }

    /** Intrinsic content height (px) for the current width. */
    fun contentHeight(): Int {
        val l = layout ?: return paddingTop + paddingBottom + lineHeight
        return l.height + paddingTop + paddingBottom
    }

    private fun dp(value: Int): Int =
        (value * resources.displayMetrics.density).toInt()
}
