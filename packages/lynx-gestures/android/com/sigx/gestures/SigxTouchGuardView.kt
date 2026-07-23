package com.sigx.gestures

import android.content.Context
import android.view.MotionEvent
import com.lynx.tasm.behavior.ui.view.AndroidView

/**
 * The backing view for `<sigx-touch-guard>` — Lynx's own [AndroidView] (so it
 * hosts the element's absolutely-positioned Lynx children correctly; a stock
 * `FrameLayout` measures them to zero) that CONSUMES the platform touch
 * stream.
 *
 * **Why this exists (#787):** a Lynx `catchtap` overlay blocks Lynx-level
 * handlers beneath it, but the raw platform `MotionEvent` still falls through
 * Lynx's native dispatch — a native input view (EditText) under the tap point
 * receives the touch and grabs focus + keyboard. `flatten={false}`,
 * `catchtouchstart`, `block-native-event` and `ignore-focus` are all
 * insufficient because the fall-through happens in the platform view tree,
 * below anything the Lynx event system can veto. The only reliable fix is a
 * native view that claims the touch target at ACTION_DOWN.
 *
 * **Touch handling is done in [dispatchTouchEvent], not `onTouchEvent`.**
 * [AndroidView] has its own touch dispatch wired into Lynx's event pipeline,
 * so an `onTouchEvent` override is bypassed (see [SigxPinchView] for the same
 * lesson). We call `super.dispatchTouchEvent` FIRST so Lynx's own pipeline
 * still sees the event — `catchtap` on this element (the backdrop's
 * tap-to-dismiss) keeps firing — and then return `true`: returning true from
 * `dispatchTouchEvent` makes this view the touch target for the gesture, so
 * the parent `ViewGroup` never offers the stream to native siblings layered
 * underneath (#787's EditText). Per-view-tree dispatch means `super` can only
 * reach OUR children, never siblings, so slotted overlay content is
 * unaffected.
 */
class SigxTouchGuardView(context: Context) : AndroidView(context) {

    /** Master switch — when false the view dispatches like a plain view. */
    var guardEnabled = true

    override fun dispatchTouchEvent(ev: MotionEvent): Boolean {
        // Feed Lynx's pipeline first: catchtap/bindtap on this element (and
        // its Lynx children) still fire. This dispatch is scoped to our own
        // subtree — it cannot leak the event to sibling views.
        val handled = super.dispatchTouchEvent(ev)
        if (!guardEnabled) return handled
        // Claim the platform touch target on ACTION_DOWN (and keep the
        // stream) so the raw MotionEvent never reaches native views UNDER
        // this overlay — an EditText below the dim can't grab focus.
        return true
    }
}
