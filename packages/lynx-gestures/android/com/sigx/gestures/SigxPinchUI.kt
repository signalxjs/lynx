package com.sigx.gestures

import android.content.Context
import com.lynx.react.bridge.Callback
import com.lynx.react.bridge.ReadableMap
import com.lynx.tasm.behavior.LynxContext
import com.lynx.tasm.behavior.LynxProp
import com.lynx.tasm.behavior.LynxUIMethod
import com.lynx.tasm.behavior.LynxUIMethodConstants
import com.lynx.tasm.behavior.ui.view.AndroidView
import com.lynx.tasm.behavior.ui.view.UIView
import com.lynx.tasm.event.LynxDetailEvent

/**
 * Native UI for the `<sigx-pinch>` JSX element on Android — two-finger
 * pinch-zoom + twist-rotate over the slotted content, backed by [SigxPinchView]
 * ([AndroidView] + [android.view.ScaleGestureDetector] + a rotation tracker).
 *
 * Extends [UIView] (not `LynxUI`) so the element hosts arbitrary Lynx children
 * the same way the built-in `<view>` does — a plain `FrameLayout` measures
 * Lynx's absolutely-positioned children to zero. See `SigxPinchUI.swift` for the
 * cross-platform rationale (Lynx ships no native pinch/rotation handler).
 *
 * Prop / event surface (v1):
 *   - `min-scale` / `max-scale`  → clamp the zoom (defaults 1 … 4)
 *   - `enable-rotation`          → allow twist-to-rotate (default true)
 *   - `enabled`                  → master gesture switch (default true)
 *   - `scale` / `rotation`       → controlled transform (rotation = radians)
 *   - `bindgesturestart`         → `{ focalX, focalY }`
 *   - `bindgesturechange`        → `{ scale, rotation, focalX, focalY }`
 *   - `bindgestureend`           → `{ scale, rotation }`
 *   - `.invoke('reset')`         → animate back to identity
 */
class SigxPinchUI(context: LynxContext) : UIView(context) {

    /** `mView` is typed `AndroidView` by [UIView]; at runtime it's ours. */
    private val pinchView: SigxPinchView
        get() = mView as SigxPinchView

    override fun createView(context: Context): AndroidView {
        return SigxPinchView(context).apply {
            listener = object : SigxPinchView.Listener {
                override fun onGestureStart(focalX: Float, focalY: Float) {
                    fireEvent("gesturestart", mapOf("focalX" to focalX, "focalY" to focalY))
                }

                override fun onGestureChange(scale: Float, rotationRadians: Float, focalX: Float, focalY: Float) {
                    fireEvent(
                        "gesturechange",
                        mapOf(
                            "scale" to scale,
                            "rotation" to rotationRadians,
                            "focalX" to focalX,
                            "focalY" to focalY,
                        ),
                    )
                }

                override fun onGestureEnd(scale: Float, rotationRadians: Float) {
                    fireEvent("gestureend", mapOf("scale" to scale, "rotation" to rotationRadians))
                }
            }
        }
    }

    // ── Prop setters ─────────────────────────────────────────────────────

    @LynxProp(name = "min-scale")
    fun setMinScale(value: Double) {
        pinchView.minScale = value.toFloat()
    }

    @LynxProp(name = "max-scale")
    fun setMaxScale(value: Double) {
        pinchView.maxScale = value.toFloat()
    }

    @LynxProp(name = "enable-rotation")
    fun setEnableRotation(value: Boolean) {
        pinchView.rotationEnabled = value
    }

    @LynxProp(name = "enabled")
    fun setEnabled(value: Boolean) {
        pinchView.gestureEnabled = value
    }

    // Controlled transform — drive scale/rotation programmatically (e.g.
    // sliders on hosts without multi-touch). `rotation` is radians (parity
    // with iOS).
    @LynxProp(name = "scale")
    fun setScale(value: Double) {
        pinchView.setControlledScale(value.toFloat())
    }

    @LynxProp(name = "rotation")
    fun setRotation(value: Double) {
        pinchView.setControlledRotationRadians(value.toFloat())
    }

    // ── Imperative methods ───────────────────────────────────────────────

    @LynxUIMethod
    fun reset(params: ReadableMap?, callback: Callback?) {
        pinchView.reset()
        callback?.invoke(LynxUIMethodConstants.SUCCESS)
    }

    // ── Event firing ─────────────────────────────────────────────────────

    private fun fireEvent(name: String, params: Map<String, Any?>) {
        val event = LynxDetailEvent(sign, name)
        for ((k, v) in params) {
            event.addDetail(k, v)
        }
        lynxContext.eventEmitter.sendCustomEvent(event)
    }
}
