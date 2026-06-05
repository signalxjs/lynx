package com.sigx.richtext

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.text.Editable
import android.text.InputType
import android.text.Spannable
import android.text.TextWatcher
import android.util.TypedValue
import android.view.inputmethod.BaseInputConnection
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import com.lynx.react.bridge.Callback
import com.lynx.react.bridge.JavaOnlyMap
import com.lynx.react.bridge.ReadableMap
import com.lynx.tasm.behavior.LynxContext
import com.lynx.tasm.behavior.LynxProp
import com.lynx.tasm.behavior.LynxUIMethod
import com.lynx.tasm.behavior.LynxUIMethodConstants
import com.lynx.tasm.behavior.ui.LynxUI
import com.lynx.tasm.event.LynxDetailEvent

/**
 * Native UI for the `<sigx-richtext>` JSX element on Android.
 *
 * See `SigxRichTextUI.swift` for the full prop/event/method contract and the
 * IME/echo rules — the two implementations mirror each other 1:1. The model
 * is carried by the sigx marker spans (`SigxSpans.kt`); native storage is
 * authoritative after every edit and the model is read back from it.
 */
class SigxRichTextUI(context: LynxContext) : LynxUI<RichEditText>(context) {

    // Lazy: LynxUI's super constructor calls createView() BEFORE this
    // class's property initializers run, so `theme` must not be touched
    // there. First access happens post-construction, when mView exists —
    // seeding from the view's platform-default color so derived visuals
    // match until the `text-color` prop overrides it.
    private val theme by lazy {
        RichTextTheme().apply {
            textColor = mView.currentTextColor
            density = mView.resources.displayMetrics.density
        }
    }
    private var localVersion = 0
    private var userHasEdited = false
    private var minHeightPx = 0f
    private var maxHeightPx = 0f
    private var lastReportedHeight = -1f
    private var isProgrammaticEdit = false

    /**
     * Collapsed-selection format toggles, pending until the next typed run —
     * Android's analogue of iOS `typingAttributes` (true = force on,
     * false = force off; absent = inherit via span flags).
     */
    private val typingOverrides = mutableMapOf<String, Boolean>()

    private var pendingInsertStart = -1
    private var pendingInsertEnd = -1

    /**
     * Queued list/quote/code continuation for the line the caret just entered
     * via Enter — the block analogue of [typingOverrides]. `SPAN_PARAGRAPH`
     * spans don't auto-extend across an inserted newline, and an empty
     * paragraph can't usefully hold one, so the span is applied when the
     * line's first run is typed (a template span; never attached itself).
     */
    private var pendingBlockStart = -1
    private var pendingBlockSpan: SigxBlockSpan? = null

    private val mainHandler = Handler(Looper.getMainLooper())

    override fun createView(context: Context): RichEditText {
        val view = RichEditText(context)
        view.inputType = InputType.TYPE_CLASS_TEXT or
            InputType.TYPE_TEXT_FLAG_MULTI_LINE or
            InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
        view.setHorizontallyScrolling(false)

        view.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) = Unit

            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                if (isProgrammaticEdit) return
                if (count > 0) {
                    pendingInsertStart = start
                    pendingInsertEnd = start + count
                } else {
                    pendingInsertStart = -1
                    pendingInsertEnd = -1
                }
            }

            override fun afterTextChanged(s: Editable?) {
                if (isProgrammaticEdit || s == null) return
                cleanupCollapsedChips(s)
                handleBlockNewline(s)
                applyPendingBlockContinuation(s)
                applyTypingOverrides(s)
                userHasEdited = true
                localVersion += 1
                reportHeightIfChanged()
                fireChange(isComposing(s))
            }
        })

        view.onSelectionChangedCallback = { start, end ->
            if (!isProgrammaticEdit) {
                // A real caret move ends any pending collapsed-toggle session
                // — but the move caused by typing itself must not, so only
                // clear when the caret lands outside the just-inserted run.
                if (pendingInsertEnd < 0 || end != pendingInsertEnd) {
                    typingOverrides.clear()
                    pendingBlockSpan = null
                    pendingBlockStart = -1
                }
                fireSelection(start, end)
            }
        }
        view.onCheckboxTap = { parStart, parEnd -> toggleTask(parStart, parEnd) }
        return view
    }

    // ── Prop setters ─────────────────────────────────────────────────────

    /** Initial document; initial-only once the user has edited (see iOS). */
    @LynxProp(name = "value")
    fun setValue(value: String?) {
        if (userHasEdited || value.isNullOrEmpty()) return
        val parsed = DocumentMapper.parse(value, theme) ?: return
        isProgrammaticEdit = true
        mView.text = parsed.text
        isProgrammaticEdit = false
        localVersion = parsed.version
        reportHeightIfChanged()
    }

    @LynxProp(name = "placeholder")
    fun setPlaceholder(value: String?) {
        mView.hint = value ?: ""
    }

    /** Editable unless explicitly disabled — `defaultBoolean = true` makes a
     *  null/absent value mean editable, mirroring iOS (`value?.boolValue ?? true`).
     *  Without it, `editable={undefined}` from JS coerces to false and the
     *  EditText becomes permanently unfocusable (#182). */
    @LynxProp(name = "editable", defaultBoolean = true)
    fun setEditable(value: Boolean) {
        mView.isEnabled = value
        mView.isFocusable = value
        mView.isFocusableInTouchMode = value
    }

    @LynxProp(name = "min-height")
    fun setMinHeight(value: Float) {
        minHeightPx = value
        reportHeightIfChanged()
    }

    @LynxProp(name = "max-height")
    fun setMaxHeight(value: Float) {
        maxHeightPx = value
        reportHeightIfChanged()
    }

    @LynxProp(name = "font-size")
    fun setEditorFontSize(value: Float) {
        if (value <= 0f) return
        theme.fontSizePx = value
        mView.setTextSize(TypedValue.COMPLEX_UNIT_DIP, value)
    }

    @LynxProp(name = "text-color")
    fun setTextColor(value: String?) {
        val color = parseColor(value) ?: return
        theme.textColor = color
        mView.setTextColor(color)
    }

    @LynxProp(name = "accent-color")
    fun setAccentColor(value: String?) {
        val color = parseColor(value) ?: return
        theme.accentColor = color
        // Retint live mention pills — spans capture their color at
        // construction (iOS rebuilds attachments on theme changes; this is
        // the Android analogue).
        val editable = mView.text
        var changed = false
        for (span in editable.getSpans(0, editable.length, SigxMention::class.java)) {
            if (span.color != color) {
                span.color = color
                changed = true
            }
        }
        if (changed) mView.invalidate()
    }

    @LynxProp(name = "placeholder-color")
    fun setPlaceholderColor(value: String?) {
        val color = parseColor(value) ?: return
        mView.setHintTextColor(color)
    }

    @LynxProp(name = "confirm-type")
    fun setConfirmType(value: String?) {
        mView.imeOptions = when (value) {
            "send" -> EditorInfo.IME_ACTION_SEND
            "search" -> EditorInfo.IME_ACTION_SEARCH
            "next" -> EditorInfo.IME_ACTION_NEXT
            "go" -> EditorInfo.IME_ACTION_GO
            "done" -> EditorInfo.IME_ACTION_DONE
            else -> EditorInfo.IME_ACTION_UNSPECIFIED
        }
    }

    @LynxProp(name = "auto-focus")
    fun setAutoFocus(value: Boolean) {
        if (!value) return
        mainHandler.post { focusAndShowIme() }
    }

    // ── UI methods ───────────────────────────────────────────────────────

    @LynxUIMethod
    fun setDocument(params: ReadableMap?, callback: Callback?) {
        val json = params?.getString("doc") ?: ""
        mainHandler.post {
            val editable = mView.text
            // Rule 4: never replace storage mid-composition.
            if (isComposing(editable)) {
                fireChange(isComposing = true)
                callback?.invoke(LynxUIMethodConstants.SUCCESS, resultMap("applied" to false, "reason" to "composing"))
                return@post
            }
            val parsed = DocumentMapper.parse(json, theme)
            if (parsed == null) {
                callback?.invoke(LynxUIMethodConstants.UNKNOWN, "setDocument: unparseable doc")
                return@post
            }
            // Rule 3: drop stale writes; re-emit so JS reconciles.
            if (parsed.version < localVersion) {
                fireChange(isComposing = false)
                callback?.invoke(LynxUIMethodConstants.SUCCESS, resultMap("applied" to false, "reason" to "stale"))
                return@post
            }
            // Rule 2: structural no-op suppression (compare canonical readback).
            val incoming = DocumentMapper.encode(parsed.text, 0)
            val current = DocumentMapper.encode(editable, 0)
            if (incoming == current) {
                localVersion = maxOf(localVersion, parsed.version)
                callback?.invoke(LynxUIMethodConstants.SUCCESS, resultMap("applied" to false, "reason" to "equal"))
                return@post
            }
            val caret = mView.selectionStart
            isProgrammaticEdit = true
            mView.text = parsed.text
            isProgrammaticEdit = false
            // The document has diverged from the initial `value` prop — lock
            // the prop out (initial-only contract), same as a user edit.
            userHasEdited = true
            localVersion = maxOf(localVersion, parsed.version)
            mView.setSelection(caret.coerceIn(0, mView.text.length))
            reportHeightIfChanged()
            fireChange(isComposing = false)
            callback?.invoke(LynxUIMethodConstants.SUCCESS, resultMap("applied" to true))
        }
    }

    @LynxUIMethod
    fun getDocument(params: ReadableMap?, callback: Callback?) {
        mainHandler.post {
            val json = DocumentMapper.encode(mView.text, localVersion)
            callback?.invoke(LynxUIMethodConstants.SUCCESS, resultMap("doc" to json))
        }
    }

    @LynxUIMethod
    fun toggleFormat(params: ReadableMap?, callback: Callback?) {
        val type = params?.getString("type") ?: ""
        if (markerClass(type) == null) {
            callback?.invoke(LynxUIMethodConstants.UNKNOWN, "toggleFormat: unknown type $type")
            return
        }
        mainHandler.post {
            val editable = mView.text
            val start = minOf(mView.selectionStart, mView.selectionEnd).coerceAtLeast(0)
            val end = maxOf(mView.selectionStart, mView.selectionEnd).coerceAtLeast(0)
            if (start == end) {
                // Collapsed: tri-state typing override (Android's typingAttributes).
                val inherited = formatActiveAt(editable, start, type)
                val current = typingOverrides[type] ?: inherited
                if (!current) {
                    // `code` is terminal (mirrors the markdown serializer):
                    // turning it on clears the marks it excludes, and the
                    // excluded marks can't turn on inside it.
                    val codeActive = typingOverrides["code"] ?: formatActiveAt(editable, start, "code")
                    if (type == "code") {
                        typingOverrides["bold"] = false
                        typingOverrides["italic"] = false
                        typingOverrides["strike"] = false
                    } else if (codeActive) {
                        fireSelection(start, end)
                        callback?.invoke(LynxUIMethodConstants.SUCCESS, resultMap("active" to false))
                        return@post
                    }
                }
                typingOverrides[type] = !current
                fireSelection(start, end)
                callback?.invoke(LynxUIMethodConstants.SUCCESS, resultMap("active" to !current))
                return@post
            }
            val active = rangeFullyHas(editable, type, start, end)
            // `code` is terminal (mirrors the markdown serializer): the marks
            // it excludes can't turn on across an all-code selection.
            if (!active && type != "code" && rangeFullyHas(editable, "code", start, end)) {
                fireSelection(start, end)
                callback?.invoke(LynxUIMethodConstants.SUCCESS, resultMap("active" to false))
                return@post
            }
            isProgrammaticEdit = true
            if (active) {
                removeFormatRange(editable, type, start, end)
            } else {
                if (type == "code") {
                    // Turning code on strips the marks it excludes.
                    removeFormatRange(editable, "bold", start, end)
                    removeFormatRange(editable, "italic", start, end)
                    removeFormatRange(editable, "strike", start, end)
                }
                editable.setSpan(newMarker(type), start, end, DocumentMapper.INLINE_FLAGS)
            }
            isProgrammaticEdit = false
            userHasEdited = true
            localVersion += 1
            mView.invalidate()
            fireChange(isComposing = false)
            fireSelection(start, end)
            callback?.invoke(LynxUIMethodConstants.SUCCESS, resultMap("active" to !active))
        }
    }

    @LynxUIMethod
    fun setBlockType(params: ReadableMap?, callback: Callback?) {
        val type = params?.getString("type") ?: "paragraph"
        val level = if (params?.hasKey("level") == true) params.getInt("level") else 0
        val checked = params?.hasKey("checked") == true && params.getBoolean("checked")
        mainHandler.post {
            val editable = mView.text
            val caretStart = minOf(mView.selectionStart, mView.selectionEnd).coerceAtLeast(0)
            val caretEnd = maxOf(mView.selectionStart, mView.selectionEnd).coerceAtLeast(0)
            val (pStart, pEnd) = DocumentMapper.snapToParagraph(editable, caretStart, caretEnd)
            // An empty paragraph can't usefully hold a SPAN_PARAGRAPH span —
            // queue the block for the line's first typed run instead (e.g.
            // tapping a list toolbar button in an empty editor).
            if (pStart == pEnd) {
                if (type == "paragraph") {
                    pendingBlockSpan = null
                    pendingBlockStart = -1
                } else {
                    pendingBlockStart = pStart
                    pendingBlockSpan = SigxBlockSpan(type, level, checked, "", theme)
                }
                fireSelection(caretStart, caretEnd)
                callback?.invoke(LynxUIMethodConstants.SUCCESS)
                return@post
            }
            isProgrammaticEdit = true
            removeBlockSpans(editable, pStart, pEnd)
            if (type != "paragraph") {
                editable.setSpan(
                    SigxBlockSpan(type, level, checked, "", theme),
                    pStart,
                    pEnd,
                    Spannable.SPAN_PARAGRAPH,
                )
                if (type == "codeBlock") {
                    editable.setSpan(
                        SigxCodeBlockBgSpan(theme.codeBackground),
                        pStart,
                        pEnd,
                        Spannable.SPAN_PARAGRAPH,
                    )
                }
            }
            isProgrammaticEdit = false
            userHasEdited = true
            localVersion += 1
            mView.invalidate()
            mView.requestLayout()
            reportHeightIfChanged()
            fireChange(isComposing = false)
            fireSelection(caretStart, caretEnd)
            callback?.invoke(LynxUIMethodConstants.SUCCESS)
        }
    }

    /**
     * Apply an inline format with a payload over an **explicit** range —
     * unlike [toggleFormat], which flips over the live selection and carries
     * no attrs. v1 supports `link`: a non-empty `attrs.href` (re)links the
     * range, an empty/missing href unlinks it.
     */
    @LynxUIMethod
    fun applyFormat(params: ReadableMap?, callback: Callback?) {
        val type = params?.getString("type") ?: ""
        if (type != "link") {
            callback?.invoke(LynxUIMethodConstants.UNKNOWN, "applyFormat: unsupported type $type")
            return
        }
        val reqStart = if (params.hasKey("start")) params.getInt("start") else -1
        val reqEnd = if (params.hasKey("end")) params.getInt("end") else -1
        val attrs = if (params.hasKey("attrs")) params.getMap("attrs") else null
        val href = attrs?.getString("href") ?: ""
        mainHandler.post {
            val editable = mView.text
            val upper = editable.length
            val start = reqStart.coerceIn(0, upper)
            val end = reqEnd.coerceIn(start, upper)
            if (end <= start) {
                callback?.invoke(LynxUIMethodConstants.SUCCESS, resultMap("applied" to false, "reason" to "emptyRange"))
                return@post
            }
            isProgrammaticEdit = true
            // Replace any overlapping links (splitting ones that extend past
            // the range), then lay down the new one.
            for (span in editable.getSpans(start, end, SigxLinkSpan::class.java)) {
                val s = editable.getSpanStart(span)
                val e = editable.getSpanEnd(span)
                editable.removeSpan(span)
                if (s < start) editable.setSpan(SigxLinkSpan(span.href, theme.accentColor), s, start, DocumentMapper.INLINE_FLAGS)
                if (e > end) editable.setSpan(SigxLinkSpan(span.href, theme.accentColor), end, e, DocumentMapper.INLINE_FLAGS)
            }
            if (href.isNotEmpty()) {
                editable.setSpan(SigxLinkSpan(href, theme.accentColor), start, end, DocumentMapper.INLINE_FLAGS)
            }
            isProgrammaticEdit = false
            userHasEdited = true
            localVersion += 1
            mView.invalidate()
            reportHeightIfChanged()
            fireChange(isComposing = false)
            fireSelection(start, end)
            callback?.invoke(LynxUIMethodConstants.SUCCESS, resultMap("applied" to true))
        }
    }

    @LynxUIMethod
    fun insertText(params: ReadableMap?, callback: Callback?) {
        val text = params?.getString("text") ?: ""
        if (text.isEmpty()) {
            callback?.invoke(LynxUIMethodConstants.SUCCESS)
            return
        }
        mainHandler.post {
            val editable = mView.text
            if (isComposing(editable)) {
                callback?.invoke(LynxUIMethodConstants.SUCCESS, resultMap("applied" to false, "reason" to "composing"))
                return@post
            }
            val start = minOf(mView.selectionStart, mView.selectionEnd).coerceAtLeast(0)
            val end = maxOf(mView.selectionStart, mView.selectionEnd).coerceAtLeast(0)
            // Goes through the TextWatcher (not flagged programmatic) so typing
            // overrides apply and change/height fire exactly like typed input.
            editable.replace(start, end, text)
            callback?.invoke(LynxUIMethodConstants.SUCCESS, resultMap("applied" to true))
        }
    }

    /**
     * Insert an atomic mention chip: one U+FFFC carrying a [SigxMentionSpan]
     * pill. `replaceFrom`/`replaceTo` first remove the trigger query run.
     * Runs as a programmatic edit (change/selection fired manually) and
     * clears typing overrides so chip state can't bleed into typed text.
     */
    @LynxUIMethod
    fun insertChip(params: ReadableMap?, callback: Callback?) {
        val id = params?.getString("id") ?: ""
        val label = params?.getString("label") ?: ""
        val kind = if (params?.hasKey("kind") == true) params.getString("kind") else null
        val replaceFrom = if (params?.hasKey("replaceFrom") == true) params.getInt("replaceFrom") else -1
        val replaceTo = if (params?.hasKey("replaceTo") == true) params.getInt("replaceTo") else -1
        // The mention contract requires a usable payload — an id-less or
        // label-less chip can't be resolved or rendered.
        if (id.isEmpty() || label.isEmpty()) {
            callback?.invoke(LynxUIMethodConstants.SUCCESS, resultMap("applied" to false, "reason" to "invalid"))
            return
        }
        mainHandler.post {
            val editable = mView.text
            if (isComposing(editable)) {
                callback?.invoke(LynxUIMethodConstants.SUCCESS, resultMap("applied" to false, "reason" to "composing"))
                return@post
            }
            val upper = editable.length
            val selStart = minOf(mView.selectionStart, mView.selectionEnd).coerceAtLeast(0)
            val selEnd = maxOf(mView.selectionStart, mView.selectionEnd).coerceAtLeast(0)
            // Replacement applies only when BOTH bounds are present (mirrors
            // iOS) — a lone bound would silently delete an unexpected range.
            val hasRange = replaceFrom >= 0 && replaceTo >= 0
            val from = if (hasRange) replaceFrom.coerceIn(0, upper) else selStart
            val to = if (hasRange) replaceTo.coerceIn(from, upper) else selEnd
            val attrs = buildMap {
                put("id", id)
                put("label", label)
                if (!kind.isNullOrEmpty()) put("kind", kind)
            }
            isProgrammaticEdit = true
            editable.replace(from, to, "\uFFFC")
            // The replaced range may have contained other chips \u2014 drop any
            // spans the replace collapsed (the watcher skips programmatic
            // edits, so this must run here).
            cleanupCollapsedChips(editable)
            editable.setSpan(
                SigxMentionSpan(attrs, theme.accentColor),
                from,
                from + 1,
                DocumentMapper.MENTION_FLAGS,
            )
            userHasEdited = true
            localVersion += 1
            typingOverrides.clear()
            // Move the caret while still under the programmatic guard —
            // otherwise onSelectionChanged fires a selection event and the
            // manual fireSelection below would duplicate it.
            val caret = (from + 1).coerceIn(0, editable.length)
            mView.setSelection(caret)
            isProgrammaticEdit = false
            mView.invalidate()
            reportHeightIfChanged()
            fireChange(isComposing = false)
            fireSelection(caret, caret)
            callback?.invoke(LynxUIMethodConstants.SUCCESS, resultMap("applied" to true))
        }
    }

    @LynxUIMethod
    fun setSelectionRange(params: ReadableMap?, callback: Callback?) {
        val start = params?.getInt("start") ?: 0
        val end = if (params?.hasKey("end") == true) params.getInt("end") else start
        mainHandler.post {
            val upper = mView.text.length
            mView.setSelection(start.coerceIn(0, upper), end.coerceIn(0, upper))
            callback?.invoke(LynxUIMethodConstants.SUCCESS)
        }
    }

    @LynxUIMethod
    fun focus(params: ReadableMap?, callback: Callback?) {
        mainHandler.post {
            focusAndShowIme()
            callback?.invoke(LynxUIMethodConstants.SUCCESS)
        }
    }

    @LynxUIMethod
    fun blur(params: ReadableMap?, callback: Callback?) {
        mainHandler.post {
            mView.clearFocus()
            val imm = mView.context.getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager
            imm?.hideSoftInputFromWindow(mView.windowToken, 0)
            callback?.invoke(LynxUIMethodConstants.SUCCESS)
        }
    }

    // ── Events ───────────────────────────────────────────────────────────

    private fun fireEvent(name: String, params: Map<String, Any?>) {
        val event = LynxDetailEvent(sign, name)
        for ((k, v) in params) event.addDetail(k, v)
        lynxContext.eventEmitter.sendCustomEvent(event)
    }

    private fun fireChange(isComposing: Boolean) {
        val json = DocumentMapper.encode(mView.text, localVersion)
        fireEvent("change", mapOf("doc" to json, "isComposing" to isComposing))
    }

    private fun fireSelection(start: Int, end: Int) {
        val editable = mView.text
        val formats = mutableListOf<String>()
        for (type in listOf("bold", "italic", "strike", "code")) {
            val active = if (start == end) {
                typingOverrides[type] ?: formatActiveAt(editable, start, type)
            } else {
                rangeFullyHas(editable, type, start, end)
            }
            if (active) formats.add(type)
        }
        if (editable.getSpans(start, maxOf(start, end), SigxLinkSpan::class.java).isNotEmpty()) {
            formats.add("link")
        }

        var activeBlock = "paragraph"
        var headingLevel: Int? = null
        val blockSpans = editable.getSpans(start, maxOf(start, end), SigxBlockSpan::class.java)
        if (blockSpans.isNotEmpty()) {
            activeBlock = blockSpans[0].type
            // `level` doubles as the ordered-run start number — only a
            // heading's level is a heading level.
            if (blockSpans[0].type == "heading" && blockSpans[0].level > 0) {
                headingLevel = blockSpans[0].level
            }
        } else if (start == end && start == pendingBlockStart) {
            // A block queued for this (still empty) line counts as active.
            pendingBlockSpan?.let { activeBlock = it.type }
        }

        val density = mView.resources.displayMetrics.density
        var caretX = 0f
        var caretY = 0f
        var caretH = 0f
        mView.layout?.let { layout ->
            val pos = end.coerceIn(0, editable.length)
            val line = layout.getLineForOffset(pos)
            caretX = (layout.getPrimaryHorizontal(pos) + mView.paddingLeft) / density
            caretY = (layout.getLineTop(line) + mView.paddingTop - mView.scrollY) / density
            caretH = (layout.getLineBottom(line) - layout.getLineTop(line)) / density
        }

        val params = mutableMapOf<String, Any?>(
            "start" to start,
            "end" to end,
            "activeFormats" to formats.joinToString(","),
            "activeBlock" to activeBlock,
            "caretX" to caretX,
            "caretY" to caretY,
            "caretHeight" to caretH,
        )
        if (headingLevel != null) params["headingLevel"] = headingLevel
        fireEvent("selection", params)
    }

    private fun reportHeightIfChanged() {
        val density = mView.resources.displayMetrics.density
        val content = mView.contentHeight() / density
        val clamped = maxOf(minHeightPx, if (maxHeightPx > 0f) minOf(content, maxHeightPx) else content)
        if (kotlin.math.abs(clamped - lastReportedHeight) >= 0.5f) {
            lastReportedHeight = clamped
            val lines = mView.lineCount.coerceAtLeast(1)
            fireEvent("heightchange", mapOf("height" to clamped, "lines" to lines))
        }
    }

    // ── Helpers ──────────────────────────────────────────────────────────

    private fun focusAndShowIme() {
        mView.requestFocus()
        val imm = mView.context.getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager
        imm?.showSoftInput(mView, InputMethodManager.SHOW_IMPLICIT)
    }

    private fun isComposing(editable: Editable): Boolean =
        BaseInputConnection.getComposingSpanStart(editable) >= 0

    /**
     * Deleting a chip's U+FFFC leaves its zero-length mention span behind
     * (Android keeps collapsed spans) — drop them so they never read back as
     * phantom mentions. `removeSpan` doesn't re-enter the watcher.
     */
    private fun cleanupCollapsedChips(editable: Editable) {
        for (span in editable.getSpans(0, editable.length, SigxMention::class.java)) {
            if (editable.getSpanStart(span) >= editable.getSpanEnd(span)) {
                editable.removeSpan(span)
            }
        }
    }

    /**
     * Enter inside a block paragraph (runs inside the TextWatcher, before the
     * change event fires, so the event already carries the result):
     *
     * - list types — Enter on an **empty** item exits the list (marker
     *   removed, the newline swallowed); Enter elsewhere continues it: the
     *   ended line keeps its span, a mid-line split makes the tail its own
     *   item immediately, and an end-of-line Enter queues the block for the
     *   new line via [pendingBlockSpan] (`task` continues unchecked);
     * - blockquote / codeBlock — always continue (exit is via toolbar).
     */
    private fun handleBlockNewline(editable: Editable) {
        if (pendingInsertStart < 0 || pendingInsertEnd != pendingInsertStart + 1) return
        val nl = pendingInsertStart
        if (nl >= editable.length || editable[nl] != '\n') return
        if (isComposing(editable)) return
        // Enter while a continuation is queued for this very line = Enter on
        // an empty item: exit instead of stacking empty items.
        if (pendingBlockSpan != null && nl == pendingBlockStart) {
            pendingBlockSpan = null
            pendingBlockStart = -1
            isProgrammaticEdit = true
            editable.delete(nl, nl + 1)
            isProgrammaticEdit = false
            return
        }
        val (pStart, pEnd) = DocumentMapper.snapToParagraph(editable, nl, nl)
        val span = editable.getSpans(pStart, pEnd, SigxBlockSpan::class.java).firstOrNull() ?: return
        val isList = span.type == "bullet" || span.type == "ordered" || span.type == "task"
        if (!isList && span.type != "blockquote" && span.type != "codeBlock") return

        if (isList && nl == pStart) {
            // Empty item: drop the marker, swallow the newline.
            isProgrammaticEdit = true
            removeBlockSpans(editable, pStart, pEnd)
            editable.delete(nl, nl + 1)
            isProgrammaticEdit = false
            return
        }

        isProgrammaticEdit = true
        // Re-snap the ended line's span to exactly its paragraph (the insert
        // may have grown it across the new line, or left the newline out).
        editable.removeSpan(span)
        editable.setSpan(
            SigxBlockSpan(span.type, span.level, span.checked, span.lang, theme),
            pStart,
            nl + 1,
            Spannable.SPAN_PARAGRAPH,
        )
        if (span.type == "codeBlock") {
            for (bg in editable.getSpans(pStart, pEnd, SigxCodeBlockBgSpan::class.java)) editable.removeSpan(bg)
            editable.setSpan(SigxCodeBlockBgSpan(theme.codeBackground), pStart, nl + 1, Spannable.SPAN_PARAGRAPH)
        }
        // Continuation never carries the ordered start or a checked state.
        val continuation = SigxBlockSpan(span.type, 0, false, span.lang, theme)
        val (nStart, nEnd) = DocumentMapper.snapToParagraph(editable, nl + 1, nl + 1)
        if (nEnd > nStart) {
            // Mid-line split: the tail is its own block line immediately.
            editable.setSpan(continuation, nStart, nEnd, Spannable.SPAN_PARAGRAPH)
            if (span.type == "codeBlock") {
                editable.setSpan(SigxCodeBlockBgSpan(theme.codeBackground), nStart, nEnd, Spannable.SPAN_PARAGRAPH)
            }
        } else {
            pendingBlockStart = nl + 1
            pendingBlockSpan = continuation
        }
        isProgrammaticEdit = false
    }

    /** Apply a queued block continuation once its line gets its first run. */
    private fun applyPendingBlockContinuation(editable: Editable) {
        val template = pendingBlockSpan ?: return
        if (pendingInsertStart != pendingBlockStart || pendingInsertEnd <= pendingInsertStart) return
        pendingBlockSpan = null
        pendingBlockStart = -1
        val (pStart, pEnd) = DocumentMapper.snapToParagraph(editable, pendingInsertStart, pendingInsertEnd)
        isProgrammaticEdit = true
        editable.setSpan(template, pStart, pEnd, Spannable.SPAN_PARAGRAPH)
        if (template.type == "codeBlock") {
            editable.setSpan(SigxCodeBlockBgSpan(theme.codeBackground), pStart, pEnd, Spannable.SPAN_PARAGRAPH)
        }
        isProgrammaticEdit = false
    }

    /** Checkbox tap on a task line: flip `checked`, redraw, fire change. */
    private fun toggleTask(parStart: Int, parEnd: Int) {
        val editable = mView.text
        val span = editable.getSpans(parStart, parEnd, SigxBlockSpan::class.java)
            .firstOrNull { it.type == "task" } ?: return
        val s = editable.getSpanStart(span)
        val e = editable.getSpanEnd(span)
        if (s < 0 || e < s) return
        isProgrammaticEdit = true
        editable.removeSpan(span)
        editable.setSpan(
            SigxBlockSpan("task", span.level, !span.checked, "", theme),
            s,
            e,
            Spannable.SPAN_PARAGRAPH,
        )
        isProgrammaticEdit = false
        userHasEdited = true
        localVersion += 1
        mView.invalidate()
        fireChange(isComposing = false)
    }

    private fun applyTypingOverrides(editable: Editable) {
        if (typingOverrides.isEmpty() || pendingInsertStart < 0 || pendingInsertEnd <= pendingInsertStart) return
        val start = pendingInsertStart.coerceIn(0, editable.length)
        val end = pendingInsertEnd.coerceIn(start, editable.length)
        isProgrammaticEdit = true
        for ((type, on) in typingOverrides) {
            if (on) {
                if (!rangeFullyHas(editable, type, start, end)) {
                    editable.setSpan(newMarker(type), start, end, DocumentMapper.INLINE_FLAGS)
                }
            } else {
                removeFormatRange(editable, type, start, end)
            }
        }
        isProgrammaticEdit = false
    }

    private fun markerClass(type: String): Class<*>? = when (type) {
        "bold" -> SigxBoldSpan::class.java
        "italic" -> SigxItalicSpan::class.java
        "strike" -> SigxStrikeSpan::class.java
        "code" -> SigxCodeSpan::class.java
        else -> null
    }

    private fun newMarker(type: String): Any = when (type) {
        "bold" -> SigxBoldSpan()
        "italic" -> SigxItalicSpan()
        "strike" -> SigxStrikeSpan()
        "code" -> SigxCodeSpan(theme.codeBackground)
        else -> throw IllegalArgumentException("unknown inline format: $type")
    }

    private fun formatActiveAt(editable: Editable, offset: Int, type: String): Boolean {
        val cls = markerClass(type) ?: return false
        // The char *before* the caret carries typing inheritance (iOS parity).
        val probe = (offset - 1).coerceAtLeast(0)
        return editable.getSpans(probe, offset, cls).any {
            editable.getSpanStart(it) < offset && editable.getSpanEnd(it) >= offset
        }
    }

    private fun rangeFullyHas(editable: Editable, type: String, start: Int, end: Int): Boolean {
        val cls = markerClass(type) ?: return false
        if (end <= start) return false
        var covered = 0
        val ranges = editable.getSpans(start, end, cls)
            .map { maxOf(editable.getSpanStart(it), start) to minOf(editable.getSpanEnd(it), end) }
            .filter { it.second > it.first }
            .sortedBy { it.first }
        var cursor = start
        for ((s, e) in ranges) {
            if (s > cursor) return false
            covered += e - maxOf(s, cursor)
            cursor = maxOf(cursor, e)
        }
        return cursor >= end && covered > 0
    }

    /**
     * Remove block-level spans over [start, end) — the model span and its
     * visual-only code-background sibling always travel together.
     */
    private fun removeBlockSpans(editable: Editable, start: Int, end: Int) {
        for (span in editable.getSpans(start, end, SigxBlockSpan::class.java)) {
            editable.removeSpan(span)
        }
        for (span in editable.getSpans(start, end, SigxCodeBlockBgSpan::class.java)) {
            editable.removeSpan(span)
        }
    }

    /** Remove a format from [start, end), splitting spans that extend past it. */
    private fun removeFormatRange(editable: Editable, type: String, start: Int, end: Int) {
        val cls = markerClass(type) ?: return
        for (span in editable.getSpans(start, end, cls)) {
            val s = editable.getSpanStart(span)
            val e = editable.getSpanEnd(span)
            editable.removeSpan(span)
            if (s < start) editable.setSpan(newMarker(type), s, start, DocumentMapper.INLINE_FLAGS)
            if (e > end) editable.setSpan(newMarker(type), end, e, DocumentMapper.INLINE_FLAGS)
        }
    }

    private fun resultMap(vararg pairs: Pair<String, Any?>): JavaOnlyMap {
        val map = JavaOnlyMap()
        for ((k, v) in pairs) {
            when (v) {
                is Boolean -> map.putBoolean(k, v)
                is Int -> map.putInt(k, v)
                is String -> map.putString(k, v)
                is Double -> map.putDouble(k, v)
                null -> map.putNull(k)
                else -> map.putString(k, v.toString())
            }
        }
        return map
    }

    private fun parseColor(value: String?): Int? {
        val raw = value?.trim()?.removePrefix("#") ?: return null
        if (raw.isEmpty()) return null
        return try {
            when (raw.length) {
                3 -> android.graphics.Color.parseColor("#" + raw.map { "$it$it" }.joinToString(""))
                6 -> android.graphics.Color.parseColor("#$raw")
                // #RRGGBBAA → Android wants #AARRGGBB.
                8 -> android.graphics.Color.parseColor("#" + raw.substring(6, 8) + raw.substring(0, 6))
                else -> null
            }
        } catch (_: IllegalArgumentException) {
            null
        }
    }
}
