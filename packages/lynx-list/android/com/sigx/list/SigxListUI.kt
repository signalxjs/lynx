package com.sigx.list

import android.util.Log
import com.lynx.react.bridge.Callback
import com.lynx.react.bridge.ReadableMap
import com.lynx.tasm.behavior.LynxContext
import com.lynx.tasm.behavior.LynxUIMethod
import com.lynx.tasm.behavior.LynxUIMethodConstants
import com.lynx.tasm.behavior.ui.list.UIList
import com.lynx.tasm.utils.PixelUtils
import kotlin.math.roundToInt

/**
 * `<list>` subclass with a frame-cheap bottom content inset (#844).
 *
 * `setBottomInset` adjusts the RecyclerView's bottom padding DIRECTLY —
 * no CSS write, no starlight layout pass — so a main-thread SharedValue
 * (keyboard lift, bottom-sheet drag) can drive it per frame via
 * `useAnimatedMethod`. `clipToPadding` is already false (`UIList.createView`),
 * so the padding acts as a pure viewport inset: growing it extends the
 * scrollable range without moving anchored content.
 *
 * Chat-pin composition: when the caller flags `pin` and the viewport sits at
 * the bottom BEFORE the change, the scroll position shifts by the inset delta
 * in the same call — the newest item stays anchored above the inset with no
 * `layoutcomplete` round trip. `setPadding` updates the padding fields
 * synchronously and the LayoutManager reads them live (`getEndAfterPadding`),
 * so the `scrollBy` consumes fully in the same frame.
 *
 * The engine re-applies CSS padding + border on every relayout
 * (`UIList.onLayoutUpdated` → `setPadding`), which would clobber the extra
 * inset — the override below stacks it back on, so the inset survives
 * relayouts. All engine access stays on public surface (`getRecyclerView`,
 * `onLayoutUpdated`, `RecyclerView.setPadding`/`scrollBy`); nothing is
 * copied from the engine, keeping the subclass resilient across engine bumps.
 */
class SigxListUI : UIList {
    constructor(context: LynxContext) : super(context)
    constructor(context: LynxContext, param: Any?) : super(context, param)

    init {
        // Verification breadcrumb for the custom-list-name opt-in: if this
        // never logs while a `bottomInset` list is on screen, the platform
        // tag didn't resolve to `sigx-list` (see #844).
        if (DEBUG) Log.d(TAG, "SigxListUI created for tag sigx-list")
    }

    /** Extra bottom inset currently applied, in device px (rounded). */
    private var extraBottomPx = 0

    /**
     * `setBottomInset({ inset, pin })` — `inset` in CSS px (dp), `pin` marks
     * chat mode's stick-to-bottom so the newest item stays anchored.
     * Cheap enough to invoke per frame from a worklet binding.
     */
    @LynxUIMethod
    fun setBottomInset(params: ReadableMap?, callback: Callback?) {
        val rv = recyclerView
        if (rv == null) {
            callback?.invoke(LynxUIMethodConstants.UNKNOWN)
            return
        }
        // Horizontal lists: vertical bottom inset is out of scope (v1) — the
        // JS side only wires vertical lists; succeed as a no-op for safety.
        if (rv.layoutManager?.canScrollVertically() != true) {
            callback?.invoke(LynxUIMethodConstants.SUCCESS)
            return
        }
        val insetCssPx = if (params != null && params.hasKey("inset")) params.getDouble("inset") else 0.0
        val pin = params != null && params.hasKey("pin") && params.getBoolean("pin")

        val newExtra = PixelUtils.dipToPx(insetCssPx.toFloat()).roundToInt().coerceAtLeast(0)
        val delta = newExtra - extraBottomPx
        if (delta == 0) {
            callback?.invoke(LynxUIMethodConstants.SUCCESS)
            return
        }
        // Pinned = at (or within 1px of) the bottom BEFORE the change. Only a
        // pinned viewport gets compensated: an inset change never moves
        // anchored content, so a user reading history sees nothing shift.
        val distanceFromBottom = rv.computeVerticalScrollRange() -
            rv.computeVerticalScrollExtent() - rv.computeVerticalScrollOffset()
        val wasPinned = pin && distanceFromBottom <= 1

        extraBottomPx = newExtra
        rv.setPadding(rv.paddingLeft, rv.paddingTop, rv.paddingRight, rv.paddingBottom + delta)
        if (wasPinned) {
            // Works for both signs: grow slides content up with the occluder,
            // shrink follows it back down.
            rv.scrollBy(0, delta)
        }
        callback?.invoke(LynxUIMethodConstants.SUCCESS)
    }

    /**
     * CSS relayout re-applies base padding + border (`UIList.onLayoutUpdated`
     * → `RecyclerView.setPadding`) — stack the extra inset back on so it
     * survives every relayout.
     */
    override fun onLayoutUpdated() {
        super.onLayoutUpdated()
        if (extraBottomPx != 0) {
            val rv = recyclerView ?: return
            rv.setPadding(rv.paddingLeft, rv.paddingTop, rv.paddingRight, rv.paddingBottom + extraBottomPx)
        }
    }

    companion object {
        private const val TAG = "SigxListUI"

        /** Flip to true to log instance creation (tag-resolution verification). */
        private const val DEBUG = false
    }
}
