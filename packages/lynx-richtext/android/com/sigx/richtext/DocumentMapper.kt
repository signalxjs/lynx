package com.sigx.richtext

import android.graphics.Color
import android.text.Spannable
import android.text.SpannableStringBuilder
import android.text.Spanned
import org.json.JSONArray
import org.json.JSONObject

/** Theme knobs shared by the spans (colors resolved on the UI side). */
data class RichTextTheme(
    var fontSizePx: Float = 0f, // 0 → leave EditText default
    var textColor: Int = Color.BLACK,
    var accentColor: Int = Color.parseColor("#3478F6"),
    var codeBackground: Int = Color.parseColor("#1F7F7F7F"), // ~12% gray
)

/**
 * RichDoc (JSON) ↔ Spannable mapping. Readback enumerates only the sigx marker
 * spans (see [SigxSpans.kt]) so the model is unambiguous; native storage is
 * authoritative after every edit.
 */
object DocumentMapper {

    /** Inline span flag: typing at the trailing edge extends the format. */
    const val INLINE_FLAGS: Int = Spanned.SPAN_EXCLUSIVE_INCLUSIVE

    data class Parsed(val text: SpannableStringBuilder, val version: Int)

    /** Parse a JSON RichDoc. Returns null when unparseable. */
    fun parse(json: String, theme: RichTextTheme): Parsed? {
        val obj = try { JSONObject(json) } catch (_: Exception) { return null }
        val text = obj.optString("text", "")
        val builder = SpannableStringBuilder(text)
        val max = builder.length

        val spans: JSONArray = obj.optJSONArray("spans") ?: JSONArray()
        for (i in 0 until spans.length()) {
            val span = spans.optJSONObject(i) ?: continue
            val start = span.optInt("start", -1).coerceIn(0, max)
            val end = span.optInt("end", -1).coerceIn(0, max)
            if (end <= start) continue
            val attrs = span.optJSONObject("attrs")
            val mark: Any? = when (span.optString("type")) {
                "bold" -> SigxBoldSpan()
                "italic" -> SigxItalicSpan()
                "strike" -> SigxStrikeSpan()
                "code" -> SigxCodeSpan(theme.codeBackground)
                "link" -> SigxLinkSpan(attrs?.optString("href") ?: "", theme.accentColor)
                "mention" -> SigxMentionSpan(attrs.toStringMap(), theme.accentColor)
                else -> null
            }
            if (mark != null) builder.setSpan(mark, start, end, INLINE_FLAGS)
        }

        val blocks: JSONArray = obj.optJSONArray("blocks") ?: JSONArray()
        for (i in 0 until blocks.length()) {
            val block = blocks.optJSONObject(i) ?: continue
            val type = block.optString("type")
            if (type.isEmpty() || type == "paragraph") continue
            val start = block.optInt("start", -1).coerceIn(0, max)
            val end = block.optInt("end", -1).coerceIn(0, max)
            if (end < start) continue
            val snapped = snapToParagraph(builder, start, end)
            builder.setSpan(
                SigxBlockSpan(type, block.optInt("level", 0), block.optBoolean("checked", false)),
                snapped.first,
                snapped.second,
                Spanned.SPAN_PARAGRAPH,
            )
        }

        return Parsed(builder, obj.optInt("v", 0))
    }

    /** Read the model back out of live storage → JSON RichDoc. */
    fun encode(text: Spannable, version: Int): String {
        val doc = JSONObject()
        doc.put("text", text.toString())

        val spans = JSONArray()
        fun add(start: Int, end: Int, type: String, attrs: JSONObject? = null) {
            if (end <= start) return
            val entry = JSONObject()
            entry.put("start", start)
            entry.put("end", end)
            entry.put("type", type)
            if (attrs != null) entry.put("attrs", attrs)
            spans.put(entry)
        }

        for (span in text.getSpans(0, text.length, SigxBoldSpan::class.java)) {
            add(text.getSpanStart(span), text.getSpanEnd(span), "bold")
        }
        for (span in text.getSpans(0, text.length, SigxItalicSpan::class.java)) {
            add(text.getSpanStart(span), text.getSpanEnd(span), "italic")
        }
        for (span in text.getSpans(0, text.length, SigxStrikeSpan::class.java)) {
            add(text.getSpanStart(span), text.getSpanEnd(span), "strike")
        }
        for (span in text.getSpans(0, text.length, SigxCodeSpan::class.java)) {
            add(text.getSpanStart(span), text.getSpanEnd(span), "code")
        }
        for (span in text.getSpans(0, text.length, SigxLinkSpan::class.java)) {
            add(
                text.getSpanStart(span), text.getSpanEnd(span), "link",
                JSONObject().put("href", span.href),
            )
        }
        for (span in text.getSpans(0, text.length, SigxMentionSpan::class.java)) {
            val attrs = JSONObject()
            for ((k, v) in span.attrs) attrs.put(k, v)
            add(text.getSpanStart(span), text.getSpanEnd(span), "mention", attrs)
        }
        doc.put("spans", spans)

        val blocks = JSONArray()
        for (span in text.getSpans(0, text.length, SigxBlockSpan::class.java)) {
            val entry = JSONObject()
            entry.put("start", text.getSpanStart(span))
            entry.put("end", text.getSpanEnd(span))
            entry.put("type", span.type)
            if (span.level > 0) entry.put("level", span.level)
            if (span.type == "task") entry.put("checked", span.checked)
            blocks.put(entry)
        }
        doc.put("blocks", blocks)
        doc.put("v", version)
        return doc.toString()
    }

    /** Snap [start, end) to enclosing line boundaries (SPAN_PARAGRAPH requirement). */
    fun snapToParagraph(text: CharSequence, start: Int, end: Int): Pair<Int, Int> {
        var s = start.coerceIn(0, text.length)
        var e = end.coerceIn(s, text.length)
        while (s > 0 && text[s - 1] != '\n') s--
        while (e < text.length && text[e] != '\n') e++
        if (e < text.length) e++ // include the trailing newline, paragraph-span style
        return s to e
    }

    private fun JSONObject?.toStringMap(): Map<String, String> {
        if (this == null) return emptyMap()
        val out = mutableMapOf<String, String>()
        for (key in keys()) out[key] = optString(key)
        return out
    }
}
