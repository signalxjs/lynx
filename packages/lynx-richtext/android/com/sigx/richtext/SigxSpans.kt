package com.sigx.richtext

import android.graphics.Typeface
import android.text.TextPaint
import android.text.style.CharacterStyle
import android.text.style.MetricAffectingSpan
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

/** Mention chip placeholder (P3 — atomic rendering lands with ReplacementSpan). */
class SigxMentionSpan(val attrs: Map<String, String>, private val color: Int) : CharacterStyle() {
    override fun updateDrawState(paint: TextPaint) {
        paint.color = color
        paint.isUnderlineText = true
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
