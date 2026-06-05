package com.sigx.richtext

import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Typeface
import android.text.TextPaint
import android.text.style.CharacterStyle
import android.text.style.MetricAffectingSpan
import android.text.style.ReplacementSpan
import android.text.style.StrikethroughSpan
import android.text.style.StyleSpan

/**
 * Marker spans — the *model* lives in the span classes themselves.
 *
 * Each sigx span both marks a model fact (bold/italic/…) and draws its visual,
 * so readback only has to enumerate these classes: a heading's bold paint
 * never reads back as a `bold` span because only [SigxBoldSpan] produces one.
 * (Mirrors the custom-attribute scheme on iOS.)
 *
 * Spans move with edits exactly like any Android span; inline spans use
 * `SPAN_EXCLUSIVE_INCLUSIVE` so typing at a format's trailing edge extends it
 * (and at the leading edge does not) — matching iOS `typingAttributes`
 * inheritance.
 */

class SigxBoldSpan : StyleSpan(Typeface.BOLD)

class SigxItalicSpan : StyleSpan(Typeface.ITALIC)

class SigxStrikeSpan : StrikethroughSpan()

/** Inline code: monospace, slightly smaller, subtle background. */
class SigxCodeSpan(private val backgroundColor: Int) : MetricAffectingSpan() {
    override fun updateMeasureState(paint: TextPaint) = apply(paint)
    override fun updateDrawState(paint: TextPaint) {
        apply(paint)
        paint.bgColor = backgroundColor
    }

    private fun apply(paint: TextPaint) {
        paint.typeface = Typeface.MONOSPACE
        paint.textSize = paint.textSize * 0.95f
    }
}

/** Link: accent color + underline. Carries the href (the model payload). */
class SigxLinkSpan(val href: String, private val color: Int) : CharacterStyle() {
    override fun updateDrawState(paint: TextPaint) {
        paint.color = color
        paint.isUnderlineText = true
    }
}

/**
 * Mention chip — an atomic pill drawn over the span's single U+FFFC char
 * (the model invariant; see `InlineSpanType` in `model/types.ts`). The
 * label lives only in [attrs]; it is never part of the document text, so
 * deletion and selection are naturally atomic (a 1-char span has no
 * interior caret position). The span is both the model carrier (readback
 * enumerates it) and the visual.
 */
class SigxMentionSpan(val attrs: Map<String, String>, private val color: Int) : ReplacementSpan() {

    private fun pillText(): String = "@${attrs["label"] ?: ""}"

    private fun pillPaint(base: Paint): TextPaint = TextPaint(base).apply {
        textSize = base.textSize * 0.9f
        typeface = Typeface.create(base.typeface, Typeface.BOLD)
        color = this@SigxMentionSpan.color
        isUnderlineText = false
    }

    private fun hPad(base: Paint): Float = base.textSize * 0.35f

    override fun getSize(paint: Paint, text: CharSequence?, start: Int, end: Int, fm: Paint.FontMetricsInt?): Int {
        if (fm != null) {
            val base = paint.fontMetricsInt
            fm.ascent = base.ascent
            fm.descent = base.descent
            fm.top = base.top
            fm.bottom = base.bottom
        }
        return (pillPaint(paint).measureText(pillText()) + hPad(paint) * 2).toInt()
    }

    override fun draw(
        canvas: Canvas,
        text: CharSequence?,
        start: Int,
        end: Int,
        x: Float,
        top: Int,
        y: Int,
        bottom: Int,
        paint: Paint,
    ) {
        val p = pillPaint(paint)
        val width = p.measureText(pillText()) + hPad(paint) * 2
        val inset = (bottom - top) * 0.08f
        val rect = RectF(x, top + inset, x + width, bottom - inset)
        val bg = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            // Accent at ~15% alpha for the pill fill.
            color = (this@SigxMentionSpan.color and 0x00FFFFFF) or (0x26 shl 24)
        }
        canvas.drawRoundRect(rect, rect.height() / 2, rect.height() / 2, bg)
        canvas.drawText(pillText(), x + hPad(paint), y.toFloat(), p)
    }
}

/**
 * Paragraph-level block style. Applied with `SPAN_PARAGRAPH` over line ranges;
 * headings scale + embolden the paint.
 */
class SigxBlockSpan(
    val type: String,
    val level: Int = 0,
    val checked: Boolean = false,
) : MetricAffectingSpan() {

    override fun updateMeasureState(paint: TextPaint) = apply(paint)
    override fun updateDrawState(paint: TextPaint) = apply(paint)

    private fun apply(paint: TextPaint) {
        if (type == "heading") {
            val (scale, bold) = when (level) {
                1 -> 1.75f to true
                2 -> 1.5f to true
                3 -> 1.25f to true
                else -> 1.1f to true
            }
            paint.textSize = paint.textSize * scale
            if (bold) paint.typeface = Typeface.create(paint.typeface, Typeface.BOLD)
        } else if (type == "codeBlock") {
            paint.typeface = Typeface.MONOSPACE
        }
    }
}
