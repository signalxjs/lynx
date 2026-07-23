package com.sigx.gestures

import android.content.Context
import com.lynx.tasm.behavior.LynxContext
import com.lynx.tasm.behavior.LynxProp
import com.lynx.tasm.behavior.ui.view.AndroidView
import com.lynx.tasm.behavior.ui.view.UIView

/**
 * Native UI for the `<sigx-touch-guard>` JSX element on Android — a
 * children-hosting container whose backing view ([SigxTouchGuardView])
 * consumes the platform touch stream, so native views layered UNDER it
 * (an EditText below an overlay dim) never receive the raw touch (#787).
 *
 * Extends [UIView] (not `LynxUI`) so the element hosts arbitrary Lynx
 * children the same way the built-in `<view>` does — overlays may carry
 * content, and a plain `FrameLayout` measures Lynx's absolutely-positioned
 * children to zero. Same rationale as [SigxPinchUI].
 *
 * Prop surface (v1):
 *   - `guard-enabled` → consume the platform touch stream (default true);
 *     when false the element behaves like a plain `<view>`.
 */
class SigxTouchGuardUI(context: LynxContext) : UIView(context) {

    /** `mView` is typed `AndroidView` by [UIView]; at runtime it's ours. */
    private val guardView: SigxTouchGuardView
        get() = mView as SigxTouchGuardView

    override fun createView(context: Context): AndroidView {
        return SigxTouchGuardView(context)
    }

    @LynxProp(name = "guard-enabled")
    fun setGuardEnabled(value: Boolean) {
        guardView.guardEnabled = value
    }
}
