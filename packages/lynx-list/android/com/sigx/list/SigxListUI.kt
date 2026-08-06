package com.sigx.list

import android.content.Context
import android.util.Log
import com.lynx.react.bridge.Callback
import com.lynx.react.bridge.JavaOnlyMap
import com.lynx.react.bridge.ReadableMap
import com.lynx.tasm.behavior.LynxContext
import com.lynx.tasm.behavior.LynxUIMethod
import com.lynx.tasm.behavior.LynxUIMethodConstants
import com.lynx.tasm.behavior.ui.list.container.ListContainerView
import com.lynx.tasm.behavior.ui.list.container.UIListContainer
import com.lynx.tasm.utils.PixelUtils
import kotlin.math.roundToInt

/**
 * Scroll container for [SigxListUI] — the engine's own [ListContainerView],
 * plus a bottom content inset.
 *
 * The inset is expressed as **extra scroll range**, not padding. Everything the
 * container clamps a scroll against comes from `getScrollRange()`
 * (`NestedScrollContainerView`: `contentHeight - (height - paddingTop -
 * paddingBottom)`), so adding to it lets the content travel that much further
 * up without touching padding, child measurement or layout — the "no layout
 * pass" contract `bottomInset` is built on (#844). It is the direct analogue of
 * iOS's `contentInset.bottom`, and unlike a padding write there is nothing to
 * re-stack after a CSS relayout: the override is evaluated live.
 */
class SigxListContainerView(
    context: Context,
    ui: UIListContainer,
) : ListContainerView(context, ui) {
    /** Extra bottom inset currently applied, in device px (never negative). */
    var extraBottomPx: Int = 0

    override fun getScrollRange(): Int = super.getScrollRange() + extraBottomPx

    /**
     * Shift the scroll offset by [delta] to keep a pinned viewport anchored
     * across an inset change.
     *
     * `View.scrollBy` does **not** work here: the container gates programmatic
     * scrolls while the native layer owns the offset
     * (`mShouldBlockScrollByListContainer`, set in `updateContentSizeAndOffset`)
     * — device-observed as `scrollY` unchanged across a `scrollBy`. The engine
     * drives the offset with `setScrollY`, so we do the same.
     */
    fun offsetScrollBy(delta: Int) {
        scrollY = (scrollY + delta).coerceIn(0, getScrollRange())
    }
}

/**
 * Native UI for the `sigx-list` platform tag (#844) — the engine's `<list>`
 * plus a frame-cheap bottom content inset.
 *
 * Registered via the autolinker (`signalx-module.json` → `android.behaviors` →
 * [SigxListBehavior]). The JS `<List>` opts in per element with
 * `custom-list-name="sigx-list"`, and **only** when its `bottomInset` prop is
 * set, so every other `<list>` keeps the engine's own class.
 *
 * ## Why this extends [UIListContainer] and not `UIList` (#930)
 *
 * The AAR ships two list implementations: the legacy `UIList` (a RecyclerView)
 * and [UIListContainer] (a `UISimpleView<ListContainerView>` whose layout and
 * scroll targets are computed natively). `<list>` resolves to the latter — so
 * the original version of this class, which extended `UIList`, did not merely
 * "add an inset to the list": naming a `custom-list-name` overrides the
 * engine's routing, so setting `bottomInset` silently moved the element onto a
 * *different, older* list implementation.
 *
 * That downgrade is what #930 was. Legacy `UIList.scrollToPosition` computes a
 * bottom-aligned instant scroll as `offset + recyclerView.height -
 * dipToPx(params.itemHeight ?: 0)` and hands it to
 * `LinearLayoutManager.scrollToPositionWithOffset`, which anchors the cell's
 * *top*. It accounts for neither the cell's real height (`itemHeight` is a
 * caller-supplied hint `@sigx/lynx-list` has no way to know) nor the padding
 * that carried the inset — so chat's first paint landed short and the newest
 * messages sat behind the composer. Only the instant path was affected; the
 * legacy *smooth* scroller gets both right, which is why sending a message
 * appeared to fix it. Extending the class the engine would have used anyway
 * removes the divergence instead of patching one symptom of it.
 *
 * Composition points with the engine (all "call super, then apply the extra" —
 * no engine logic copied):
 *  - [createView] substitutes [SigxListContainerView], whose `getScrollRange`
 *    carries the inset.
 *  - [scrollToPosition] biases `offset` by `-inset` for bottom-aligned scrolls:
 *    the engine resolves `alignTo` natively against the *un-inset* viewport
 *    bottom, so every chat re-pin would otherwise land under the occluder.
 *    Same correction, and the same reason, as the iOS override.
 */
class SigxListUI : UIListContainer {
    constructor(context: LynxContext) : super(context)
    constructor(context: LynxContext, param: Any?) : super(context, param)

    init {
        // Verification breadcrumb for the custom-list-name opt-in: if this
        // never logs while a `bottomInset` list is on screen, the platform tag
        // didn't resolve to `sigx-list` (see #844).
        if (DEBUG) Log.d(TAG, "SigxListUI created for tag sigx-list")
    }

    private val container: SigxListContainerView?
        get() = view as? SigxListContainerView

    /**
     * Same as `UIListContainer.createView`, with our container substituted —
     * including the scroll-state listener registration it does (the UI itself
     * implements `OnScrollStateChangeListener`), which is not reachable via
     * `super` since we cannot re-type the view it constructs.
     */
    override fun createView(context: Context): ListContainerView {
        val v = SigxListContainerView(context, this)
        v.addOnScrollStateChangeListener(this)
        return v
    }

    /**
     * `setBottomInset({ inset, pin })` — `inset` in CSS px (dp), `pin` marks
     * chat mode's stick-to-bottom so the newest item stays anchored above the
     * inset. Cheap enough to invoke per frame from a worklet binding: it moves
     * one int and, at most, one scroll offset.
     */
    @LynxUIMethod
    fun setBottomInset(params: ReadableMap?, callback: Callback?) {
        val v = container
        if (v == null) {
            callback?.invoke(LynxUIMethodConstants.UNKNOWN)
            return
        }
        val insetCssPx = if (params != null && params.hasKey("inset")) params.getDouble("inset") else 0.0
        val pin = params != null && params.hasKey("pin") && params.getBoolean("pin")

        val newExtra = PixelUtils.dipToPx(insetCssPx.toFloat()).roundToInt().coerceAtLeast(0)
        val delta = newExtra - v.extraBottomPx
        if (delta == 0) {
            callback?.invoke(LynxUIMethodConstants.SUCCESS)
            return
        }
        // Pinned = at (or within 1px of) max scroll BEFORE the change. Only a
        // pinned viewport is compensated: growing or shrinking the inset never
        // moves anchored content, so a user reading history sees nothing shift.
        val wasPinned = pin && (v.getScrollRange() - v.scrollY) <= 1

        v.extraBottomPx = newExtra
        if (wasPinned) {
            // Works for both signs: grow slides content up with the occluder,
            // shrink follows it back down.
            v.offsetScrollBy(delta)
        } else if (delta < 0) {
            // Not pinned and the range shrank: the current offset can now sit
            // past the end. Clamp, or the content stays over-scrolled until the
            // next touch.
            val max = v.getScrollRange()
            if (v.scrollY > max) v.offsetScrollBy(max - v.scrollY)
        }
        if (DEBUG) {
            Log.d(
                TAG,
                "setBottomInset inset=$insetCssPx px=$newExtra delta=$delta pinned=$wasPinned " +
                    "scrollY=${v.scrollY} range=${v.getScrollRange()}",
            )
        }
        callback?.invoke(LynxUIMethodConstants.SUCCESS)
    }

    /**
     * Bias bottom-aligned scrolls by the extra inset.
     *
     * The engine resolves `alignTo` in native code (`ListContainerProxy` /
     * `IListNodeInfoFetcher.scrollToPosition`) against the viewport bottom,
     * which knows nothing about the extra scroll range this class adds. Without
     * the bias every chat pin lands the newest cell against the *raw* bottom
     * edge — underneath the keyboard or composer the inset exists to clear.
     * `offset` is in CSS px and moves the target down, so the correction is a
     * subtraction. Mirrors `SigxListUI.swift`.
     */
    @LynxUIMethod
    override fun scrollToPosition(params: ReadableMap?, callback: Callback?) {
        val extra = container?.extraBottomPx ?: 0
        if (extra == 0 || params == null || params.getString("alignTo") != "bottom") {
            super.scrollToPosition(params, callback)
            return
        }
        val biased = JavaOnlyMap.shallowCopy(params)
        val offset = if (params.hasKey("offset")) params.getDouble("offset") else 0.0
        biased.putDouble("offset", offset - PixelUtils.pxToDip(extra.toFloat()))
        super.scrollToPosition(biased, callback)
    }

    companion object {
        private const val TAG = "SigxListUI"

        /** Flip to true to log instance creation and inset writes. */
        private const val DEBUG = false
    }
}
