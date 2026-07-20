package com.sigx.gestures

import android.content.Context
import android.os.SystemClock
import android.util.Log
import android.view.MotionEvent
import android.view.ScaleGestureDetector
import com.lynx.tasm.behavior.ui.view.AndroidView
import kotlin.math.atan2

/**
 * The backing view for `<sigx-pinch>` — Lynx's own [AndroidView] (so it hosts
 * the element's absolutely-positioned Lynx children correctly; a stock
 * `FrameLayout` measures them to zero) plus pinch-zoom / twist-rotate.
 *
 * **Touch handling is done in [dispatchTouchEvent], not `onTouchEvent`.**
 * [AndroidView] has its own touch dispatch wired into Lynx's event pipeline, so
 * a child-level `onTouchEvent` override is bypassed. Feeding the detectors in
 * `dispatchTouchEvent` (which every touch passes through top-down) sees the
 * full pointer stream; once a two-finger gesture is active we
 * `requestDisallowInterceptTouchEvent(true)` so an ancestor `<scroll-view>`
 * can't steal it, and consume the event (return true) so Lynx doesn't also act
 * on it. Single-finger touches fall through to `super` untouched.
 *
 * Zoom is driven by [ScaleGestureDetector]; rotation by a two-pointer angle
 * tracker. The transform is applied via [setScaleX]/[setScaleY]/[setRotation] —
 * render-time transforms independent of layout, pivoting on the view centre.
 */
class SigxPinchView(context: Context) : AndroidView(context) {

    interface Listener {
        fun onGestureStart(focalX: Float, focalY: Float)
        fun onGestureChange(scale: Float, rotationRadians: Float, focalX: Float, focalY: Float)
        fun onGestureEnd(scale: Float, rotationRadians: Float)
    }

    var minScale = 1f
    var maxScale = 4f
    var rotationEnabled = true
    var gestureEnabled = true
    var listener: Listener? = null

    private var curScale = 1f
    private var curRotationDeg = 0f
    private var active = false
    /** Angle (radians) between the first two pointers on the previous move. */
    private var lastAngle = 0f

    private val scaleDetector = ScaleGestureDetector(
        context,
        object : ScaleGestureDetector.SimpleOnScaleGestureListener() {
            override fun onScale(d: ScaleGestureDetector): Boolean {
                curScale = (curScale * d.scaleFactor).coerceIn(minScale, maxScale)
                applyTransform()
                emitChange(d.focusX, d.focusY)
                return true
            }
        },
    )

    override fun dispatchTouchEvent(ev: MotionEvent): Boolean {
        if (!gestureEnabled) return super.dispatchTouchEvent(ev)

        // Feed the detectors finger coordinates mapped OUT of our own transform.
        // Android delivers touches in this view's post-transform local space, so
        // as we scale/rotate the view the finger span/angle the detector measures
        // is warped by the very transform we're applying — a feedback loop that
        // makes the gesture oscillate ("fighting") and resist shrinking. Applying
        // the view's matrix maps the points back to the stable parent space.
        val mapped = MotionEvent.obtain(ev)
        mapped.transform(matrix)
        scaleDetector.onTouchEvent(mapped)
        // Claims disallow-intercept once (and only once) a second finger lands,
        // and releases it the moment the 2-finger gesture ends (see below).
        trackRotationAndPhases(mapped)
        mapped.recycle()

        // Let Lynx/children process the ORIGINAL event (taps inside the content).
        super.dispatchTouchEvent(ev)

        // Return true so Android keeps routing the stream here — without it the
        // view stops receiving events after ACTION_DOWN and never sees the second
        // finger (the diagnostic showed only pointers=1 DOWNs arriving). This does
        // NOT block single-finger scrolling: we don't `requestDisallowInterceptTouchEvent`
        // until a 2-finger gesture actually begins, so an ancestor <scroll-view>
        // can still intercept a one-finger drag and CANCEL us.
        return true
    }

    private fun trackRotationAndPhases(ev: MotionEvent) {
        when (ev.actionMasked) {
            MotionEvent.ACTION_POINTER_DOWN -> {
                if (ev.pointerCount >= 2) {
                    lastAngle = angleBetween(ev)
                    if (!active) {
                        active = true
                        lastEmitMs = 0L
                        // Now that a real 2-finger gesture is underway, lock out
                        // ancestor interception (e.g. a parent <scroll-view>).
                        parent?.requestDisallowInterceptTouchEvent(true)
                        if (DEBUG) Log.d(TAG, "gesture START")
                        listener?.onGestureStart(focalX(ev), focalY(ev))
                    }
                }
            }
            MotionEvent.ACTION_MOVE -> {
                if (active && rotationEnabled && ev.pointerCount >= 2) {
                    val angle = angleBetween(ev)
                    var delta = Math.toDegrees((angle - lastAngle).toDouble()).toFloat()
                    // Unwrap across the ±180° seam so a twist past vertical
                    // doesn't jump the accumulated rotation by a full turn.
                    if (delta > 180f) delta -= 360f
                    if (delta < -180f) delta += 360f
                    curRotationDeg += delta
                    lastAngle = angle
                    applyTransform()
                    emitChange(focalX(ev), focalY(ev))
                }
            }
            MotionEvent.ACTION_POINTER_UP, MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                val remaining = ev.pointerCount - if (ev.actionMasked == MotionEvent.ACTION_POINTER_UP) 1 else 0
                if (active && remaining < 2) {
                    active = false
                    // Release the ancestor lock as soon as the 2-finger gesture
                    // ends — don't wait for the final ACTION_UP with one finger
                    // still down, which would keep scrolling disabled.
                    parent?.requestDisallowInterceptTouchEvent(false)
                    if (DEBUG) Log.d(TAG, "gesture END scale=$curScale rotDeg=$curRotationDeg")
                    emitEnd()
                }
            }
        }
    }

    fun reset() {
        curScale = 1f
        curRotationDeg = 0f
        animate().scaleX(1f).scaleY(1f).rotation(0f).setDuration(250).start()
    }

    /**
     * Controlled setters — drive the transform from JS (e.g. sliders).
     *
     * Ignored while a gesture is active: during a pinch the native view owns the
     * transform, and each frame it also emits `change`, which the app echoes back
     * into these props a frame late. Applying that stale value would fight the
     * live gesture (the "jumps back / doesn't follow" symptom). Between gestures
     * (`active == false`) the props drive normally, so sliders still work.
     */
    fun setControlledScale(value: Float) {
        if (active) return
        val s = value.coerceIn(minScale, maxScale)
        if (s == curScale) return
        curScale = s
        applyTransform()
    }

    fun setControlledRotationRadians(radians: Float) {
        if (active) return
        val deg = Math.toDegrees(radians.toDouble()).toFloat()
        if (deg == curRotationDeg) return
        curRotationDeg = deg
        applyTransform()
    }

    private fun applyTransform() {
        scaleX = curScale
        scaleY = curScale
        rotation = curRotationDeg
    }

    private var lastEmitMs = 0L

    private fun emitChange(fx: Float, fy: Float) {
        // Throttle the JS event to ~30/sec. Lynx rate-limits DispatchEvent
        // (error 204 "called too frequently" after ~800 in a window), and a
        // 60fps gesture would trip it. The native transform still updates every
        // frame (smooth), and emitEnd() sends the exact final value unthrottled.
        val now = SystemClock.uptimeMillis()
        if (now - lastEmitMs < EMIT_THROTTLE_MS) return
        lastEmitMs = now
        listener?.onGestureChange(curScale, Math.toRadians(curRotationDeg.toDouble()).toFloat(), fx, fy)
    }

    private fun emitEnd() {
        listener?.onGestureEnd(curScale, Math.toRadians(curRotationDeg.toDouble()).toFloat())
    }

    private fun angleBetween(ev: MotionEvent): Float {
        val dx = ev.getX(1) - ev.getX(0)
        val dy = ev.getY(1) - ev.getY(0)
        return atan2(dy, dx)
    }

    private fun focalX(ev: MotionEvent): Float = (ev.getX(0) + ev.getX(1)) / 2f
    private fun focalY(ev: MotionEvent): Float = (ev.getY(0) + ev.getY(1)) / 2f

    private companion object {
        const val TAG = "SigxPinchGesture"
        const val DEBUG = false
        /** Min interval between `change` events (~30/sec) to stay under Lynx's dispatch cap. */
        const val EMIT_THROTTLE_MS = 33L
    }
}
