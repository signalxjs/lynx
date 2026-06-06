package com.sigx.richtext

import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Typeface
import android.text.Layout
import android.text.Spanned
import android.text.TextPaint
import android.text.style.CharacterStyle
import android.text.style.LeadingMarginSpan
import android.text.style.LineBackgroundSpan
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
 *
 * Color-carrying spans hold the shared [RichTextTheme] reference and read
 * their colors at draw time — never captured at construction — so a theme
 * switch (`text-color`/`accent-color` props) recolors every existing run
 * with a single invalidate, the Android analogue of iOS `refreshAllVisuals`
 * (#155).
 */

class SigxBoldSpan : StyleSpan(Typeface.BOLD)

class SigxItalicSpan : StyleSpan(Typeface.ITALIC)

class SigxStrikeSpan : StrikethroughSpan()

/** Inline code: monospace, slightly smaller, subtle background. */
class SigxCodeSpan(private val theme: RichTextTheme) : MetricAffectingSpan() {
    override fun updateMeasureState(paint: TextPaint) = apply(paint)
    override fun updateDrawState(paint: TextPaint) {
        apply(paint)
        paint.bgColor = theme.codeBackground
    }

    private fun apply(paint: TextPaint) {
        paint.typeface = Typeface.MONOSPACE
        paint.textSize = paint.textSize * 0.95f
    }
}

/** Link: accent color + underline. Carries the href (the model payload). */
class SigxLinkSpan(val href: String, private val theme: RichTextTheme) : CharacterStyle() {
    override fun updateDrawState(paint: TextPaint) {
        paint.color = theme.accentColor
        paint.isUnderlineText = true
    }
}

/** Common surface for mention model carriers — readback enumerates this. */
interface SigxMention {
    val attrs: Map<String, String>
}

/**
 * Mention chip — an atomic pill drawn over the span's single U+FFFC char
 * (the model invariant; see `InlineSpanType` in `model/types.ts`). The
 * label lives only in [attrs]; it is never part of the document text, so
 * deletion and selection are naturally atomic (a 1-char span has no
 * interior caret position). The span is both a model carrier (readback
 * enumerates [SigxMention]) and the visual.
 */
class SigxMentionSpan(
    override val attrs: Map<String, String>,
    private val theme: RichTextTheme,
) : ReplacementSpan(), SigxMention {

    private val pillText: String = "@${attrs["label"] ?: ""}"

    // Reused across measure/draw passes (UI-thread only) — ReplacementSpans
    // redraw on every scroll/selection tick, so per-draw allocations add up.
    private val workPaint = TextPaint()
    private val bgRect = RectF()

    private fun configure(base: Paint): TextPaint {
        workPaint.set(base)
        workPaint.textSize = base.textSize * 0.9f
        workPaint.typeface = Typeface.create(base.typeface, Typeface.BOLD)
        // The base paint may carry decorations from overlapping spans
        // (strike/underline/code background) — a chip never inherits them.
        workPaint.isUnderlineText = false
        workPaint.isStrikeThruText = false
        workPaint.bgColor = 0
        workPaint.isAntiAlias = true
        return workPaint
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
        // Round up — truncation can clip the last glyph / background edge.
        return kotlin.math.ceil(configure(paint).measureText(pillText) + hPad(paint) * 2).toInt()
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
        val p = configure(paint)
        val pad = hPad(paint)
        val width = p.measureText(pillText) + pad * 2
        val inset = (bottom - top) * 0.08f
        bgRect.set(x, top + inset, x + width, bottom - inset)
        // Accent at ~15% alpha for the fill, accent for the label — one
        // reused paint, two color passes (no per-draw allocations).
        p.color = (theme.accentColor and 0x00FFFFFF) or (0x26 shl 24)
        canvas.drawRoundRect(bgRect, bgRect.height() / 2, bgRect.height() / 2, p)
        p.color = theme.accentColor
        canvas.drawText(pillText, x + pad, y.toFloat(), p)
    }
}

/**
 * Fallback carrier for a mention span that does NOT conform to the chip
 * invariant (not exactly one U+FFFC): attrs still round-trip through
 * readback, but the covered text renders literally with an accent underline
 * — mirroring iOS, where only conforming spans get an attachment.
 */
class SigxMentionTextSpan(
    override val attrs: Map<String, String>,
    private val theme: RichTextTheme,
) : CharacterStyle(), SigxMention {
    override fun updateDrawState(paint: TextPaint) {
        paint.color = theme.accentColor
        paint.isUnderlineText = true
    }
}

/**
 * Paragraph-level block style. Applied with `SPAN_PARAGRAPH` over line ranges;
 * headings scale + embolden the paint, and the block decorations — list
 * markers (bullet dot / ordered number / task checkbox) and the blockquote
 * bar — are **draw-only**: painted into the leading margin this span
 * reserves, never present in the text, so they can't be edited or leak into
 * serialization. Ordered numbers are computed from the run position at draw
 * time (never stored), so renumbering on insert/delete is automatic; `level`
 * on the run's first span carries a non-1 start number.
 *
 * Readback still reads only [type]/[level]/[checked]/[lang] — the drawing is
 * invisible to the model.
 */
class SigxBlockSpan(
    val type: String,
    val level: Int = 0,
    val checked: Boolean = false,
    val lang: String = "",
    private val theme: RichTextTheme,
) : MetricAffectingSpan(), LeadingMarginSpan {

    // Reused across draw passes (UI-thread only) — margins redraw on every
    // scroll/selection tick, so per-draw allocations add up.
    private val workPaint = TextPaint()
    private val workRect = RectF()
    private val workPath = Path()

    override fun updateMeasureState(paint: TextPaint) = apply(paint)
    override fun updateDrawState(paint: TextPaint) = apply(paint)

    private fun apply(paint: TextPaint) {
        if (type == "heading") {
            val (scale, bold) = when (level) {
                1 -> 1.75f to true
                2 -> 1.5f to true
                3 -> 1.25f to true
                4 -> 1.1f to true
                5 -> 1.0f to true
                else -> 0.9f to true
            }
            paint.textSize = paint.textSize * scale
            if (bold) paint.typeface = Typeface.create(paint.typeface, Typeface.BOLD)
        } else if (type == "codeBlock") {
            paint.typeface = Typeface.MONOSPACE
            paint.textSize = paint.textSize * 0.95f
        }
    }

    private fun dp(value: Float): Float = value * theme.density

    /** Gutter the markers draw into (also the checkbox tap target width). */
    override fun getLeadingMargin(first: Boolean): Int = when (type) {
        "bullet", "ordered", "task" -> dp(28f).toInt()
        "blockquote" -> dp(16f).toInt()
        "codeBlock" -> dp(8f).toInt()
        else -> 0
    }

    override fun drawLeadingMargin(
        c: Canvas,
        p: Paint,
        x: Int,
        dir: Int,
        top: Int,
        baseline: Int,
        bottom: Int,
        text: CharSequence,
        start: Int,
        end: Int,
        first: Boolean,
        layout: Layout?,
    ) {
        when (type) {
            // The bar spans every visual line of the quote, not just the first.
            "blockquote" -> {
                workPaint.set(p)
                workPaint.color = fade(theme.textColor, 0x4D) // ~30%
                val barW = dp(3f)
                val left = x + dir * dp(2f)
                workRect.set(
                    minOf(left, left + dir * barW), top.toFloat(),
                    maxOf(left, left + dir * barW), bottom.toFloat(),
                )
                c.drawRect(workRect, workPaint)
            }
            "bullet" -> if (first) {
                workPaint.set(p)
                workPaint.isAntiAlias = true
                workPaint.color = theme.textColor
                val cx = x + dir * dp(12f)
                c.drawCircle(cx, (top + bottom) / 2f, dp(2.5f), workPaint)
            }
            "ordered" -> if (first) {
                workPaint.set(p)
                workPaint.isAntiAlias = true
                workPaint.color = theme.textColor
                workPaint.textSize = p.textSize
                val label = "${orderedNumber(text)}."
                val width = workPaint.measureText(label)
                // Right-aligned against the text edge, with a small gap.
                val edge = x + dir * (getLeadingMargin(first) - dp(6f))
                c.drawText(label, if (dir > 0) edge - width else edge, baseline.toFloat(), workPaint)
            }
            "task" -> if (first) {
                val size = dp(15f)
                val cy = (top + bottom) / 2f
                val near = x + dir * dp(4f)
                val far = near + dir * size
                workRect.set(minOf(near, far), cy - size / 2, maxOf(near, far), cy + size / 2)
                workPaint.set(p)
                workPaint.isAntiAlias = true
                val corner = dp(3f)
                if (checked) {
                    workPaint.style = Paint.Style.FILL
                    workPaint.color = theme.accentColor
                    c.drawRoundRect(workRect, corner, corner, workPaint)
                    // Check mark.
                    workPaint.color = android.graphics.Color.WHITE
                    workPaint.style = Paint.Style.STROKE
                    workPaint.strokeWidth = dp(1.8f)
                    workPath.reset()
                    workPath.moveTo(workRect.left + size * 0.25f, cy)
                    workPath.lineTo(workRect.left + size * 0.45f, cy + size * 0.2f)
                    workPath.lineTo(workRect.left + size * 0.78f, cy - size * 0.22f)
                    c.drawPath(workPath, workPaint)
                } else {
                    workPaint.style = Paint.Style.STROKE
                    workPaint.strokeWidth = dp(1.5f)
                    workPaint.color = fade(theme.textColor, 0x99) // ~60%
                    c.drawRoundRect(workRect, corner, corner, workPaint)
                }
                workPaint.style = Paint.Style.FILL
            }
        }
    }

    // Numbering cache, keyed on (theme.drawGeneration, span start) — the UI
    // bumps the generation on every content mutation, so scroll/selection
    // redraws are O(1) per line and an edit renumbers the run once.
    private var cachedGen = -1
    private var cachedStart = -1
    private var cachedNumber = 0

    /**
     * 1-based number for an `ordered` line, derived from its position in the
     * run of consecutive ordered paragraphs (paragraph spans are adjacent when
     * the previous span's end — its trailing `\n` — is this span's start).
     * The run's first span may carry a non-1 start in [level]. The recursion
     * fills the whole run's caches in one pass.
     */
    private fun orderedNumber(text: CharSequence): Int {
        val spanned = text as? Spanned ?: return maxOf(level, 1)
        val gen = theme.drawGeneration
        val myStart = spanned.getSpanStart(this)
        if (cachedGen == gen && cachedStart == myStart) return cachedNumber
        val prev = if (myStart > 0) {
            spanned.getSpans(myStart - 1, myStart, SigxBlockSpan::class.java)
                .firstOrNull {
                    it.type == "ordered" &&
                        spanned.getSpanEnd(it) == myStart &&
                        spanned.getSpanStart(it) < myStart // collapsed span — defensive
                }
        } else {
            null
        }
        val number = when {
            prev == null -> if (level > 0) level else 1
            prev.cachedGen == gen && prev.cachedStart == spanned.getSpanStart(prev) -> prev.cachedNumber + 1
            else -> prev.orderedNumber(text) + 1
        }
        cachedGen = gen
        cachedStart = myStart
        cachedNumber = number
        return number
    }

    private fun fade(color: Int, alpha: Int): Int = (color and 0x00FFFFFF) or (alpha shl 24)
}

/**
 * Full-width code-block background. Pure visual sibling of
 * `SigxBlockSpan(type = "codeBlock")` — applied/removed in lockstep with it
 * and **never enumerated by readback** (it carries no model fact).
 * `LeadingMarginSpan` can't paint behind the text, hence the separate span.
 */
class SigxCodeBlockBgSpan(private val theme: RichTextTheme) : LineBackgroundSpan {
    private val rect = RectF()
    private val bgPaint = Paint()

    override fun drawBackground(
        canvas: Canvas,
        paint: Paint,
        left: Int,
        right: Int,
        top: Int,
        baseline: Int,
        bottom: Int,
        text: CharSequence,
        start: Int,
        end: Int,
        lineNumber: Int,
    ) {
        bgPaint.color = theme.codeBackground
        rect.set(left.toFloat(), top.toFloat(), right.toFloat(), bottom.toFloat())
        canvas.drawRect(rect, bgPaint)
    }
}
