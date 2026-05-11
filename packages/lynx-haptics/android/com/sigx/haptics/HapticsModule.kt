package com.sigx.haptics

import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import com.lynx.jsbridge.LynxMethod
import com.lynx.jsbridge.LynxModule
import com.lynx.react.bridge.Callback
import com.lynx.react.bridge.JavaOnlyMap
import com.lynx.react.bridge.ReadableMap

/**
 * Native haptic feedback module.
 * JS usage: NativeModules.Haptics.impact("medium")
 */
class HapticsModule(context: Context) : LynxModule(context) {

    private val vibrator: Vibrator by lazy {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val mgr = mContext.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager
            mgr.defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            mContext.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
        }
    }

    /**
     * Trigger an impact haptic.
     * @param style "light" | "medium" | "heavy" | "rigid" | "soft"
     *
     * On API 29+ uses VibrationEffect.createPredefined which routes
     * through the system haptic engine — the same one used by the
     * keyboard and other system feedback. Old createOneShot durations
     * (10–30ms) were too short to register on devices with haptic
     * actuators (Pixel, modern Samsung), where the actuator needs the
     * predefined effect ID to map to a tuned waveform.
     *
     * Falls back to amplitude-controlled oneshot on API 26-28.
     */
    /**
     * USAGE_TOUCH explicitly tags the vibration as a UI feedback effect.
     * Some Pixel + Samsung One UI versions silently drop vibrate() calls
     * lacking AudioAttributes because the OS routes them through the
     * "haptic feedback" channel (separate from "ringtone" or "alarm")
     * which requires explicit attribution to be enabled.
     */
    private val touchAttrs: AudioAttributes by lazy {
        AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ASSISTANCE_SONIFICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build()
    }

    @LynxMethod
    fun impact(style: String?) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val effect = when (style ?: "medium") {
                "light", "soft" -> VibrationEffect.EFFECT_TICK
                "heavy", "rigid" -> VibrationEffect.EFFECT_HEAVY_CLICK
                else -> VibrationEffect.EFFECT_CLICK // "medium"
            }
            vibrator.vibrate(VibrationEffect.createPredefined(effect), touchAttrs)
            return
        }

        // Pre-API 29 fallback — boosted durations so older non-actuator
        // devices still produce a perceptible buzz.
        val duration = when (style ?: "medium") {
            "light", "soft" -> 30L
            "heavy", "rigid" -> 80L
            else -> 50L
        }
        vibrate(duration)
    }

    /**
     * Returns vibrator + permission state via callback so JS callers can
     * surface diagnostics directly into the UI without needing logcat.
     * Used by the example app's module probe card.
     */
    @LynxMethod
    fun diagnose(callback: Callback?) {
        val map = JavaOnlyMap()
        map.putBoolean("hasVibrator", vibrator.hasVibrator())
        map.putInt("sdk", Build.VERSION.SDK_INT)
        map.putBoolean(
            "hasVibratePermission",
            mContext.checkSelfPermission(android.Manifest.permission.VIBRATE)
                == PackageManager.PERMISSION_GRANTED
        )
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            map.putBoolean("hasAmplitudeControl", vibrator.hasAmplitudeControl())
        }
        callback?.invoke(map)
    }

    /**
     * Trigger a notification haptic.
     * @param type "success" | "warning" | "error"
     *
     * On API 29+ uses paired predefined effects to differentiate the
     * three types — `success` is a single tick, `warning` a double-click,
     * `error` is a heavy-click pattern.
     */
    @LynxMethod
    fun notification(type: String?) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val effect = when (type ?: "success") {
                "warning" -> VibrationEffect.EFFECT_DOUBLE_CLICK
                "error" -> VibrationEffect.EFFECT_HEAVY_CLICK
                else -> VibrationEffect.EFFECT_CLICK // "success"
            }
            vibrator.vibrate(VibrationEffect.createPredefined(effect), touchAttrs)
            return
        }

        // Pre-API 29 fallback — patterned waveforms.
        val pattern = when (type ?: "success") {
            "success" -> longArrayOf(0, 30, 60, 30)
            "warning" -> longArrayOf(0, 50, 80, 50, 80, 50)
            "error" -> longArrayOf(0, 80, 50, 80, 50, 80)
            else -> longArrayOf(0, 30, 60, 30)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            vibrator.vibrate(VibrationEffect.createWaveform(pattern, -1))
        } else {
            @Suppress("DEPRECATION")
            vibrator.vibrate(pattern, -1)
        }
    }

    /** Trigger a selection change haptic (brief tick). */
    @LynxMethod
    fun selection() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            vibrator.vibrate(VibrationEffect.createPredefined(VibrationEffect.EFFECT_TICK), touchAttrs)
            return
        }
        vibrate(20L)
    }

    private fun vibrate(durationMs: Long) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            vibrator.vibrate(
                VibrationEffect.createOneShot(durationMs, VibrationEffect.DEFAULT_AMPLITUDE),
                touchAttrs
            )
        } else {
            @Suppress("DEPRECATION")
            vibrator.vibrate(durationMs)
        }
    }
}

